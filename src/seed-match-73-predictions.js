import { newId } from './id.js';
import { store } from './store.js';

const POOL_ID = 'pool_copa_2026';
const MATCH_NUMBER = 73;

const predictions = [
  ['flaviobp', 1, 3],
  ['fabioskomori', 2, 1],
  ['marinohc', 0, 2],
  ['GabrielMoraes', 2, 0],
  ['lfregnani', 1, 2],
  ['caiobosco', 0, 2],
  ['vagmachado', 1, 2],
  ['marcior', 1, 3],
  ['Marga', 1, 1],
  ['Leandro01', 2, 3],
  ['SergioP', 2, 1],
  ['victor', 0, 3],
  ['renatothx', 0, 1],
  ['Edu', 0, 1],
  ['taniaafs', 0, 1],
  ['lsergioa', 1, 4],
  ['Ruigrao', 1, 2],
  ['Osvaldo', 2, 1],
  ['edival', 2, 1],
  ['Favato', 0, 1],
  ['joao_ivonaldo', 0, 2],
  ['mjardim', 0, 2],
  ['rodrigogirckus', 1, 2],
  ['simasgabriel', 0, 1],
  ['TizuruMaria', 0, 2],
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
