import { newId } from './id.js';
import { store } from './store.js';

const POOL_ID = 'pool_copa_2026';
const MATCH_NUMBER = 4;

const predictions = [
  ['SergioP', 2, 2],
  ['fabioskomori', 2, 1],
  ['simasgabriel', 1, 1],
  ['renatothx', 2, 0],
  ['mjardim', 2, 1],
  ['lsergioa', 2, 2],
  ['joao_ivonaldo', 2, 2],
  ['rodrigogirckus', 1, 1],
  ['marcior', 1, 2],
  ['vagmachado', 2, 1],
  ['caiobosco', 2, 0],
  ['Leandro01', 3, 1],
  ['victor', 1, 0],
  ['lfregnani', 2, 0],
  ['marinohc', 2, 1],
  ['Marga', 2, 0],
  ['Edu', 1, 2],
  ['edival', 1, 1],
  ['cido', 2, 1],
  ['flaviobp', 2, 1],
  ['rupcic', 2, 1],
  ['ydirickson', 1, 3],
  ['Branca', 5, 2],
  ['Osvaldo', 1, 2],
  ['taniaafs', 2, 2],
  ['mrportof', 1, 1],
  ['Ruigrao', 1, 1],
  ['Favato', 0, 0],
  ['GabrielMoraes', 1, 1],
  ['TizuruMaria', 1, 1],
  ['mcesar', 2, 0],
].map(([username, homeGoals, awayGoals]) => ({ username, homeGoals, awayGoals }));

function usernameKey(value) {
  return String(value).toLowerCase();
}

await store.load();

const summary = await store.transaction((db) => {
  const now = new Date().toISOString();
  const match = db.matches.find((candidate) => candidate.matchNumber === MATCH_NUMBER);
  if (!match) throw new Error(`Jogo ${MATCH_NUMBER} nao encontrado`);

  const pool = db.pools.find((candidate) => candidate.id === POOL_ID || candidate.isActive);
  if (!pool) throw new Error(`Bolao ${POOL_ID} nao encontrado`);

  const usersByUsername = new Map(db.users
    .filter((user) => user.username)
    .map((user) => [usernameKey(user.username), user]));

  const missing = predictions
    .filter((prediction) => !usersByUsername.has(usernameKey(prediction.username)))
    .map((prediction) => prediction.username);
  if (missing.length > 0) {
    throw new Error(`Usuarios nao encontrados: ${missing.join(', ')}`);
  }

  let created = 0;
  let updated = 0;

  for (const prediction of predictions) {
    const user = usersByUsername.get(usernameKey(prediction.username));
    const existing = db.predictions.find((candidate) => (
      candidate.poolId === pool.id
      && candidate.userId === user.id
      && candidate.matchId === match.id
    ));

    if (existing) {
      existing.homeGoals = prediction.homeGoals;
      existing.awayGoals = prediction.awayGoals;
      existing.updatedAt = now;
      updated++;
      continue;
    }

    db.predictions.push({
      id: newId('pred'),
      poolId: pool.id,
      userId: user.id,
      matchId: match.id,
      homeGoals: prediction.homeGoals,
      awayGoals: prediction.awayGoals,
      createdAt: now,
      updatedAt: now,
    });
    created++;
  }

  return {
    store: store.kind,
    poolId: pool.id,
    matchId: match.id,
    matchNumber: match.matchNumber,
    predictions: predictions.length,
    created,
    updated,
  };
});

console.log(JSON.stringify(summary, null, 2));
