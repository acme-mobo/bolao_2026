import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyDb, FirestoreStore, toNoSqlShape } from '../src/store.js';

function createFakeFirestore(initialData = {}) {
  const data = structuredClone(initialData);
  const reads = [];
  const commits = [];
  const rootDoc = {
    collection(collectionName) {
      return {
        doc(id) {
          return { collectionName, id };
        },
        async get() {
          reads.push(collectionName);
          const collection = data[collectionName] ?? {};
          return {
            docs: Object.entries(collection).map(([id, value]) => ({
              id,
              ref: { collectionName, id },
              data: () => ({ ...value }),
            })),
          };
        },
      };
    },
  };

  return {
    data,
    reads,
    commits,
    collection() {
      return { doc: () => rootDoc };
    },
    batch() {
      const ops = [];
      return {
        set(ref, item) {
          ops.push({ type: 'set', ref, item: { ...item } });
        },
        delete(ref) {
          ops.push({ type: 'delete', ref });
        },
        async commit() {
          for (const op of ops) {
            data[op.ref.collectionName] ??= {};
            if (op.type === 'delete') {
              delete data[op.ref.collectionName][op.ref.id];
            } else {
              data[op.ref.collectionName][op.ref.id] = { ...op.item };
            }
          }
          commits.push(ops);
        },
      };
    },
  };
}

test('toNoSqlShape inclui standings para salvar Firestore', () => {
  const db = emptyDb();
  db.standings = [
    {
      id: 'A_MEX',
      group: 'A',
      teamCode: 'MEX',
      points: 0,
    },
  ];

  const shape = toNoSqlShape(db);

  assert.deepEqual(Object.keys(shape).sort(), [
    'matches',
    'memberships',
    'pools',
    'predictions',
    'standings',
    'teams',
    'users',
  ]);
  assert.equal(shape.standings.A_MEX.teamCode, 'MEX');
});

test('FirestoreStore reutiliza cache em memoria por colecao', async () => {
  const firestore = createFakeFirestore({
    matches: {
      match_1: { status: 'scheduled' },
    },
  });
  const store = new FirestoreStore({ firestore, cacheTtlMs: 60_000 });

  await store.loadCollections(['matches']);
  await store.loadCollections(['matches']);

  assert.deepEqual(firestore.reads, ['matches']);
});

test('FirestoreStore salva somente documentos alterados das colecoes carregadas', async () => {
  const firestore = createFakeFirestore({
    users: {
      user_1: { name: 'Vagner' },
    },
    predictions: {
      pred_1: { poolId: 'pool', userId: 'user_1', matchId: 'match_1', homeGoals: 1, awayGoals: 0 },
      pred_2: { poolId: 'pool', userId: 'user_2', matchId: 'match_1', homeGoals: 2, awayGoals: 0 },
    },
  });
  const store = new FirestoreStore({ firestore, cacheTtlMs: 60_000 });

  const db = await store.loadCollections(['predictions']);
  db.predictions[0].homeGoals = 3;
  await store.save();

  assert.deepEqual(firestore.reads, ['predictions']);
  assert.equal(firestore.commits.length, 1);
  assert.deepEqual(firestore.commits[0].map((op) => ({
    type: op.type,
    collection: op.ref.collectionName,
    id: op.ref.id,
  })), [
    { type: 'set', collection: 'predictions', id: 'pred_1' },
  ]);
  assert.equal(firestore.data.predictions.pred_1.homeGoals, 3);
  assert.equal(firestore.data.users.user_1.name, 'Vagner');
});
