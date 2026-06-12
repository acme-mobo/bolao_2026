import { newId } from './id.js';
import { store } from './store.js';

const POOL_ID = 'pool_copa_2026';
const MATCH_NUMBER = 6;

const predictions = [
  ['SergioP', 3, 2],
  ['fabioskomori', 1, 0],
  ['simasgabriel', 0, 0],
  ['renatothx', 1, 1],
  ['mjardim', 0, 2],
  ['lsergioa', 2, 2],
  ['joao_ivonaldo', 1, 1],
  ['rodrigogirckus', 0, 1],
  ['marcior', 1, 2],
  ['vagmachado', 1, 1],
  ['caiobosco', 0, 2],
  ['Leandro01', 2, 2],
  ['victor', 0, 1],
  ['lfregnani', 0, 2],
  ['marinohc', 1, 1],
  ['Marga', 1, 0],
  ['Edu', 2, 1],
  ['edival', 0, 2],
  ['cido', 0, 1],
  ['flaviobp', 0, 1],
  ['rupcic', 1, 1],
  ['ydirickson', 2, 0],
  ['Branca', 3, 0],
  ['Osvaldo', 3, 2],
  ['taniaafs', 2, 4],
  ['mrportof', 2, 1],
  ['Ruigrao', 0, 1],
  ['Favato', 1, 1],
  ['GabrielMoraes', 0, 1],
  ['TizuruMaria', 1, 2],
  ['mcesar', 1, 2],
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
