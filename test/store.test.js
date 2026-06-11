import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyDb, toNoSqlShape } from '../src/store.js';

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
