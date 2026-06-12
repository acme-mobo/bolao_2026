import { newId } from './id.js';
import { store } from './store.js';

const POOL_ID = 'pool_copa_2026';
const MATCH_NUMBER = 1;

const predictions = [
  ['simasgabriel', 2, 0],
  ['renatothx', 2, 0],
  ['rodrigogirckus', 2, 0],
  ['lsergioa', 2, 0],
  ['vagmachado', 2, 0],
  ['victor', 2, 0],
  ['lfregnani', 2, 0],
  ['Marga', 2, 0],
  ['Edu', 2, 0],
  ['TizuruMaria', 2, 0],
  ['mcesar', 2, 0],
  ['SergioP', 3, 1],
  ['fabioskomori', 3, 1],
  ['mjardim', 1, 0],
  ['joao_ivonaldo', 2, 1],
  ['marcior', 2, 1],
  ['caiobosco', 2, 1],
  ['Leandro01', 3, 1],
  ['marinohc', 2, 1],
  ['Favato', 2, 1],
  ['cido', 3, 1],
  ['flaviobp', 2, 1],
  ['ydirickson', 2, 1],
  ['Branca', 1, 0],
  ['Osvaldo', 2, 1],
  ['taniaafs', 3, 0],
  ['mrportof', 1, 0],
  ['Ruigrao', 2, 1],
  ['GabrielMoraes', 4, 0],
  ['edival', 1, 2],
  ['rupcic', 1, 1],
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
