import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getAdminFirestore } from './firebase-admin.js';

const collections = ['users', 'teams', 'matches', 'pools', 'memberships', 'predictions', 'standings'];

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

function toNoSqlShape(db) {
  return {
    users: collectionToMap(db.users),
    teams: collectionToMap(db.teams),
    matches: collectionToMap(db.matches),
    pools: collectionToMap(db.pools),
    memberships: collectionToMap(db.memberships, membershipId),
    predictions: collectionToMap(db.predictions),
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
  }

  rootDoc() {
    const firestore = this.firestore ?? getAdminFirestore();
    return firestore.collection(this.rootPath).doc('default');
  }

  async load() {
    const root = this.rootDoc();
    const loaded = emptyDb();
    for (const collection of collections) {
      const snapshot = await root.collection(collection).get();
      loaded[collection] = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }
    this.db = normalizeDb(loaded);
    return this.db;
  }

  async save() {
    const root = this.rootDoc();
    const shape = toNoSqlShape(this.db);
    const batch = (this.firestore ?? getAdminFirestore()).batch();

    for (const collection of collections) {
      const snapshot = await root.collection(collection).get();
      for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
      }

      for (const [id, item] of Object.entries(shape[collection])) {
        batch.set(root.collection(collection).doc(id), item);
      }
    }

    await batch.commit();
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
