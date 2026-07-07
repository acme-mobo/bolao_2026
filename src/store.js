import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getAdminFirestore } from './firebase-admin.js';

const collections = ['users', 'teams', 'matches', 'pools', 'memberships', 'predictions', 'standings'];
const DEFAULT_FIRESTORE_CACHE_TTL_MS = 60_000;

export const emptyDb = () => ({
  users: [],
  teams: [],
  matches: [],
  pools: [],
  memberships: [],
  predictions: [],
  standings: [],
});

function membershipId(membership) {
  return membership.id ?? `${membership.poolId}_${membership.userId}`;
}

function collectionToArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).map(([id, item]) => ({ id: item.id ?? id, ...item }));
}

function normalizeDb(value) {
  const db = emptyDb();
  for (const collection of collections) {
    db[collection] = collectionToArray(value?.[collection]);
  }
  return db;
}

function collectionToMap(collection, keyForItem = (item) => item.id) {
  return Object.fromEntries(collection.map((item) => [keyForItem(item), item]));
}

function cloneCollection(collection) {
  return collection.map((item) => ({ ...item }));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneShape(shape) {
  return JSON.parse(JSON.stringify(shape));
}

export function toNoSqlShape(db) {
  return {
    users: collectionToMap(db.users),
    teams: collectionToMap(db.teams),
    matches: collectionToMap(db.matches),
    pools: collectionToMap(db.pools),
    memberships: collectionToMap(db.memberships, membershipId),
    predictions: collectionToMap(db.predictions),
    standings: collectionToMap(db.standings),
  };
}

export class JsonFileStore {
  constructor(file = config.dataFile) {
    this.file = file;
    this.db = emptyDb();
    this.kind = 'json';
  }

  async load() {
    if (!fs.existsSync(this.file)) {
      await this.save();
      return this.db;
    }

    const raw = fs.readFileSync(this.file, 'utf8');
    this.db = raw.trim() ? normalizeDb(JSON.parse(raw)) : emptyDb();
    return this.db;
  }

  async loadCollections() {
    return this.load();
  }

  async save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify(this.db, null, 2)}\n`);
  }

  async transaction(mutator) {
    const result = mutator(this.db);
    const resolved = result instanceof Promise ? await result : result;
    await this.save();
    return resolved;
  }
}

export class FirestoreStore {
  constructor(options = {}) {
    this.rootPath = options.rootPath ?? config.firebaseRootPath;
    this.db = emptyDb();
    this.kind = 'firestore';
    this.firestore = options.firestore ?? null;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_FIRESTORE_CACHE_TTL_MS;
    this.collectionCache = new Map();
    this.loadedCollections = new Set();
    this.originalShape = cloneShape(toNoSqlShape(this.db));
  }

  rootDoc() {
    const firestore = this.firestore ?? getAdminFirestore();
    return firestore.collection(this.rootPath).doc('default');
  }

  async load() {
    return this.loadCollections(collections);
  }

  async loadCollections(selectedCollections = collections) {
    const root = this.rootDoc();
    const loaded = emptyDb();
    const now = Date.now();
    for (const collection of selectedCollections) {
      const cached = this.collectionCache.get(collection);
      if (cached && now - cached.fetchedAt < this.cacheTtlMs) {
        loaded[collection] = cloneCollection(cached.data);
        continue;
      }

      const snapshot = await root.collection(collection).get();
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      this.collectionCache.set(collection, { data: cloneCollection(data), fetchedAt: now });
      loaded[collection] = data;
    }
    this.db = normalizeDb(loaded);
    this.loadedCollections = new Set(selectedCollections);
    this.originalShape = cloneShape(toNoSqlShape(this.db));
    return this.db;
  }

  async save() {
    const root = this.rootDoc();
    const shape = toNoSqlShape(this.db);
    const firestore = this.firestore ?? getAdminFirestore();
    const batch = firestore.batch();
    const selectedCollections = this.loadedCollections.size
      ? [...this.loadedCollections]
      : collections;
    let operations = 0;

    for (const collection of selectedCollections) {
      const before = this.originalShape[collection] ?? {};
      const after = shape[collection] ?? {};

      for (const id of Object.keys(before)) {
        if (!(id in after)) {
          batch.delete(root.collection(collection).doc(id));
          operations++;
        }
      }

      for (const [id, item] of Object.entries(after)) {
        if (!sameJson(before[id], item)) {
          batch.set(root.collection(collection).doc(id), item);
          operations++;
        }
      }
    }

    if (operations > 0) await batch.commit();

    const fetchedAt = Date.now();
    for (const collection of selectedCollections) {
      this.collectionCache.set(collection, {
        data: cloneCollection(this.db[collection] ?? []),
        fetchedAt,
      });
    }
    this.originalShape = cloneShape(toNoSqlShape(this.db));
  }

  async transaction(mutator) {
    const result = mutator(this.db);
    const resolved = result instanceof Promise ? await result : result;
    await this.save();
    return resolved;
  }
}

export const Store = JsonFileStore;

export function createStore() {
  if (config.dataStore === 'firestore' || config.dataStore === 'firebase') {
    return new FirestoreStore();
  }

  return new JsonFileStore();
}

export const store = createStore();
