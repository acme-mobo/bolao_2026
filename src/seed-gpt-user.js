import { hashPassword } from './auth.js';
import { getAdminAuth } from './firebase-admin.js';
import { store } from './store.js';

const DEFAULT_PASSWORD = 'mvp12345';
const POOL_ID = 'pool_copa_2026';
const USER = {
  id: 'mvp-player-gpt',
  name: 'GPT',
  username: 'GPT',
  email: 'gpt@bolao26.local',
};

async function upsertAuthUser(user) {
  if (!['firestore', 'firebase'].includes(store.kind)) return 'skipped';

  const auth = getAdminAuth();
  try {
    await auth.updateUser(user.id, {
      email: user.email,
      password: DEFAULT_PASSWORD,
      displayName: user.name,
      emailVerified: true,
      disabled: false,
    });
    return 'updated';
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    await auth.createUser({
      uid: user.id,
      email: user.email,
      password: DEFAULT_PASSWORD,
      displayName: user.name,
      emailVerified: true,
      disabled: false,
    });
    return 'created';
  }
}

await store.load();

const now = new Date().toISOString();

const summary = await store.transaction((db) => {
  const pool = db.pools.find((candidate) => candidate.id === POOL_ID || candidate.isActive);
  if (!pool) throw new Error(`Bolao ${POOL_ID} nao encontrado`);

  let user = db.users.find((candidate) => (
    candidate.id === USER.id
    || candidate.username?.toLowerCase() === USER.username.toLowerCase()
    || candidate.email?.toLowerCase() === USER.email.toLowerCase()
  ));

  let userAction = 'updated';
  if (!user) {
    user = {
      ...USER,
      passwordHash: hashPassword(DEFAULT_PASSWORD),
      role: 'player',
      createdAt: now,
    };
    db.users.push(user);
    userAction = 'created';
  } else {
    user.id ||= USER.id;
    user.name = USER.name;
    user.username = USER.username;
    user.email = USER.email;
    user.passwordHash ||= hashPassword(DEFAULT_PASSWORD);
    user.role ||= 'player';
    user.createdAt ||= now;
  }

  let membershipAction = 'exists';
  const membership = db.memberships.find((candidate) => (
    candidate.poolId === pool.id && candidate.userId === user.id
  ));
  if (!membership) {
    db.memberships.push({ poolId: pool.id, userId: user.id, joinedAt: now });
    membershipAction = 'created';
  }

  return {
    store: store.kind,
    poolId: pool.id,
    userId: user.id,
    username: user.username,
    user: userAction,
    membership: membershipAction,
    password: DEFAULT_PASSWORD,
  };
});

const auth = await upsertAuthUser(USER);

console.log(JSON.stringify({ ...summary, auth }, null, 2));
