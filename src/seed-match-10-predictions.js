import { newId } from './id.js';
import { store } from './store.js';

const POOL_ID = 'pool_copa_2026';
const MATCH_NUMBER = 10;

const predictions = [
  ['SergioP', 3, 0],
  ['fabioskomori', 4, 0],
  ['renatothx', 5, 0],
  ['mjardim', 4, 0],
  ['lsergioa', 5, 1],
  ['joao_ivonaldo', 5, 0],
  ['rodrigogirckus', 3, 0],
  ['vagmachado', 4, 0],
  ['caiobosco', 5, 0],
  ['marcior', 5, 0],
  ['Leandro01', 7, 0],
  ['victor', 4, 0],
  ['simasgabriel', 4, 0],
  ['lfregnani', 4, 0],
  ['marinohc', 4, 0],
  ['Marga', 4, 0],
  ['Edu', 3, 0],
  ['edival', 5, 0],
  ['cido', 5, 0],
  ['flaviobp', 3, 1],
  ['rupcic', 2, 0],
  ['ydirickson', 4, 0],
  ['Branca', 5, 0],
  ['Osvaldo', 3, 0],
  ['taniaafs', 5, 0],
  ['mrportof', 4, 0],
  ['Ruigrao', 3, 0],
  ['Favato', 4, 0],
  ['GabrielMoraes', 5, 0],
  ['TizuruMaria', 3, 0],
  ['mcesar', 5, 0],
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
