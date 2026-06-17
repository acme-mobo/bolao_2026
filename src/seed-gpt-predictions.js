import { hashPassword } from './auth.js';
import { newId } from './id.js';
import { store } from './store.js';

const DEFAULT_PASSWORD = 'mvp12345';
const POOL_ID = 'pool_copa_2026';
const USER = {
  id: 'mvp-player-gpt',
  name: 'GPT',
  username: 'GPT',
  email: 'gpt@bolao26.local',
};

const predictions = [
  [1, 2, 0],
  [2, 2, 1],
  [3, 2, 0],
  [4, 2, 1],
  [5, 2, 1],
  [6, 1, 1],
  [7, 0, 2],
  [8, 0, 2],
  [9, 1, 2],
  [10, 3, 0],
  [11, 2, 1],
  [12, 1, 1],
  [13, 0, 2],
  [14, 3, 0],
  [15, 3, 0],
  [16, 2, 1],
  [17, 2, 1],
  [18, 1, 2],
  [19, 2, 0],
  [20, 2, 0],
  [21, 0, 2],
  [22, 2, 1],
  [23, 2, 0],
  [24, 0, 2],
  [25, 1, 2],
  [26, 2, 1],
  [27, 2, 0],
  [28, 2, 1],
  [29, 1, 2],
  [30, 3, 0],
  [31, 2, 1],
  [32, 2, 1],
  [33, 2, 0],
  [34, 3, 0],
  [35, 2, 0],
  [36, 1, 2],
  [37, 2, 0],
  [38, 3, 0],
  [39, 2, 1],
  [40, 0, 2],
  [41, 1, 2],
  [42, 3, 0],
  [43, 2, 1],
  [44, 1, 2],
  [45, 3, 0],
  [46, 1, 2],
  [47, 2, 0],
  [48, 2, 0],
  [49, 1, 2],
  [50, 3, 0],
  [51, 2, 1],
  [52, 1, 2],
  [53, 1, 2],
  [54, 0, 2],
  [55, 0, 2],
  [56, 1, 2],
  [57, 2, 1],
  [58, 0, 2],
  [59, 1, 2],
  [60, 1, 2],
  [61, 1, 2],
  [62, 2, 0],
  [63, 1, 2],
  [64, 0, 3],
  [65, 1, 2],
  [66, 1, 2],
  [67, 1, 2],
  [68, 3, 0],
  [69, 1, 2],
  [70, 0, 3],
  [71, 1, 2],
  [72, 1, 2],
].map(([matchNumber, homeGoals, awayGoals]) => ({ matchNumber, homeGoals, awayGoals }));

function usernameKey(value) {
  return String(value).toLowerCase();
}

await store.load();

const summary = await store.transaction((db) => {
  const now = new Date().toISOString();

  const pool = db.pools.find((candidate) => candidate.id === POOL_ID || candidate.isActive);
  if (!pool) throw new Error(`Bolao ${POOL_ID} nao encontrado`);

  let user = db.users.find((candidate) => (
    candidate.id === USER.id
    || usernameKey(candidate.username) === usernameKey(USER.username)
    || usernameKey(candidate.email) === usernameKey(USER.email)
  ));

  if (!user) {
    user = {
      ...USER,
      passwordHash: hashPassword(DEFAULT_PASSWORD),
      role: 'player',
      createdAt: now,
    };
    db.users.push(user);
  } else {
    user.name = USER.name;
    user.username = USER.username;
    user.email = USER.email;
    user.passwordHash ||= hashPassword(DEFAULT_PASSWORD);
    user.role ||= 'player';
    user.createdAt ||= now;
  }

  const membership = db.memberships.find((candidate) => (
    candidate.poolId === pool.id && candidate.userId === user.id
  ));
  if (!membership) {
    db.memberships.push({ poolId: pool.id, userId: user.id, joinedAt: now });
  }

  const matchesByNumber = new Map(db.matches.map((match) => [match.matchNumber, match]));
  const missingMatches = predictions
    .filter((prediction) => !matchesByNumber.has(prediction.matchNumber))
    .map((prediction) => prediction.matchNumber);
  if (missingMatches.length > 0) {
    throw new Error(`Jogos nao encontrados: ${missingMatches.join(', ')}`);
  }

  let created = 0;
  let updated = 0;

  for (const prediction of predictions) {
    const match = matchesByNumber.get(prediction.matchNumber);
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
    userId: user.id,
    username: user.username,
    predictions: predictions.length,
    created,
    updated,
  };
});

console.log(JSON.stringify(summary, null, 2));
