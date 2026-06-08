import { hashPassword } from './auth.js';
import { newId } from './id.js';
import { store } from './store.js';

const PLAYER_COUNT = 10;
const DEFAULT_PASSWORD = 'mvp12345';
const POOL_ID = 'pool_copa_2026';

function predictionFor(playerIndex, matchIndex) {
  const homeGoals = (playerIndex + matchIndex) % 5;
  const awayGoals = (playerIndex * 2 + matchIndex * 3) % 5;
  return { homeGoals, awayGoals };
}

await store.load();

const summary = await store.transaction((db) => {
  const now = new Date().toISOString();
  let pool = db.pools.find((candidate) => candidate.isActive) ?? db.pools.find((candidate) => candidate.id === POOL_ID);

  if (!pool) {
    pool = {
      id: POOL_ID,
      name: 'Bolao Copa 2026',
      ownerId: 'mvp-player-01',
      inviteCode: 'COPA2026',
      isActive: true,
      createdAt: now,
    };
    db.pools.push(pool);
  } else {
    pool.isActive = true;
    pool.inviteCode ??= 'COPA2026';
    pool.ownerId ??= 'mvp-player-01';
  }

  let usersCreated = 0;
  let membershipsCreated = 0;
  let predictionsCreated = 0;
  let predictionsUpdated = 0;

  for (let index = 1; index <= PLAYER_COUNT; index++) {
    const padded = String(index).padStart(2, '0');
    const userId = `mvp-player-${padded}`;
    const email = `mvp${padded}@bolao26.local`;
    let user = db.users.find((candidate) => candidate.id === userId || candidate.email === email);

    if (!user) {
      user = {
        id: userId,
        name: `MVP Player ${padded}`,
        email,
        passwordHash: hashPassword(DEFAULT_PASSWORD),
        role: 'player',
        createdAt: now,
      };
      db.users.push(user);
      usersCreated++;
    } else {
      user.id = userId;
      user.name ||= `MVP Player ${padded}`;
      user.email = email;
      user.passwordHash ||= hashPassword(DEFAULT_PASSWORD);
      user.role ||= 'player';
      user.createdAt ||= now;
    }

    const membership = db.memberships.find(
      (candidate) => candidate.poolId === pool.id && candidate.userId === user.id,
    );
    if (!membership) {
      db.memberships.push({ poolId: pool.id, userId: user.id, joinedAt: now });
      membershipsCreated++;
    }

    db.matches.forEach((match, matchIndex) => {
      const goals = predictionFor(index, matchIndex);
      const existing = db.predictions.find(
        (candidate) => candidate.poolId === pool.id && candidate.userId === user.id && candidate.matchId === match.id,
      );

      if (existing) {
        existing.homeGoals = goals.homeGoals;
        existing.awayGoals = goals.awayGoals;
        existing.updatedAt = now;
        predictionsUpdated++;
        return;
      }

      db.predictions.push({
        id: newId('pred'),
        poolId: pool.id,
        userId: user.id,
        matchId: match.id,
        homeGoals: goals.homeGoals,
        awayGoals: goals.awayGoals,
        createdAt: now,
        updatedAt: now,
      });
      predictionsCreated++;
    });
  }

  return {
    store: store.kind,
    poolId: pool.id,
    players: PLAYER_COUNT,
    matches: db.matches.length,
    usersCreated,
    membershipsCreated,
    predictionsCreated,
    predictionsUpdated,
    password: DEFAULT_PASSWORD,
  };
});

console.log(JSON.stringify(summary, null, 2));
