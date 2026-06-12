import { hashPassword } from './auth.js';
import { getAdminAuth } from './firebase-admin.js';
import { store } from './store.js';

const DEFAULT_PASSWORD = 'mvp12345';
const POOL_ID = 'pool_copa_2026';
const TECH_EMAIL_DOMAIN = 'bolao26.local';

const participants = [
  ['Renato', 'renatothx'],
  ['Victor P Rael', 'victor'],
  ['Eduardo Jose e Silva', 'Edu'],
  ['Gabriel', 'GabrielMoraes'],
  ['Mauro César Bernardes', 'mcesar'],
  ['Tania', 'taniaafs'],
  ['Tizuru Maria Misawa', 'TizuruMaria'],
  ['Aparecido Castilho Filho', 'cido'],
  ['Fabio Sussumu', 'fabioskomori'],
  ['Joao', 'joao_ivonaldo'],
  ['Osvaldo', 'Osvaldo'],
  ['Leandro', 'lfregnani'],
  ['Marga', 'Marga'],
  ['LUIZ SERGIO DE ALMEIDA', 'lsergioa'],
  ['Vagner', 'vagmachado'],
  ['gabriel da silva simas', 'simasgabriel'],
  ['Rodrigo', 'rodrigogirckus'],
  ['MARIO', 'mrportof'],
  ['Marina de Souza', 'Branca'],
  ['Caio Cesar Bosco', 'caiobosco'],
  ['Fernando A Favato', 'Favato'],
  ['Flávio Bezerra Pereira', 'flaviobp'],
  ['LEANDROKleber', 'Leandro01'],
  ['Marino', 'marinohc'],
  ['Marcos Jardim', 'mjardim'],
  ['Rui', 'Ruigrao'],
  ['João', 'rupcic'],
  ['Sergio R Poltronieri', 'SergioP'],
  ['Yuri Dirickson', 'ydirickson'],
  ['Marcio Ribeiro', 'marcior'],
  ['Edival Pereira de Souza Filho', 'edival'],
].map(([name, username]) => ({ name, username }));

function userIdFor(sequence, username) {
  if (username === 'vagmachado') return null;
  return `mvp-player-${String(sequence).padStart(2, '0')}`;
}

function emailFor(username) {
  return `${username.toLowerCase()}@${TECH_EMAIL_DOMAIN}`;
}

async function upsertAuthUser({ id, name, email }) {
  if (!['firestore', 'firebase'].includes(store.kind)) return 'skipped';

  const auth = getAdminAuth();
  try {
    await auth.updateUser(id, {
      email,
      password: DEFAULT_PASSWORD,
      displayName: name,
      emailVerified: true,
      disabled: false,
    });
    return 'updated';
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    await auth.createUser({
      uid: id,
      email,
      password: DEFAULT_PASSWORD,
      displayName: name,
      emailVerified: true,
      disabled: false,
    });
    return 'created';
  }
}

await store.load();

const now = new Date().toISOString();
const authSummary = { created: 0, updated: 0, skipped: 0 };
const planned = [];

const summary = await store.transaction((db) => {
  let pool = db.pools.find((candidate) => candidate.id === POOL_ID || candidate.isActive);
  if (!pool) {
    pool = {
      id: POOL_ID,
      name: 'Bolão Copa 2026',
      ownerId: null,
      inviteCode: 'COPA2026',
      isActive: true,
      createdAt: now,
    };
    db.pools.push(pool);
  }
  pool.id = pool.id || POOL_ID;
  pool.name ||= 'Bolão Copa 2026';
  pool.inviteCode ||= 'COPA2026';
  pool.isActive = true;

  let usersCreated = 0;
  let usersUpdated = 0;
  let membershipsCreated = 0;
  const participantIds = new Set();
  const legacyMvpIds = new Set(Array.from({ length: 10 }, (_, index) => `mvp-player-${String(index + 1).padStart(2, '0')}`));
  let mvpSequence = 0;

  for (const participant of participants) {
    if (participant.username !== 'vagmachado') mvpSequence++;
    const fallbackId = userIdFor(mvpSequence, participant.username);
    const email = emailFor(participant.username);
    let user = db.users.find((candidate) => candidate.username === participant.username);

    if (!user && participant.username === 'vagmachado') {
      user = db.users.find((candidate) => candidate.email === 'vmachado@usp.br' || candidate.role === 'admin');
    }

    if (!user && fallbackId) {
      user = db.users.find((candidate) => candidate.id === fallbackId);
    }

    if (!user) {
      user = {
        id: fallbackId,
        name: participant.name,
        username: participant.username,
        email,
        passwordHash: hashPassword(DEFAULT_PASSWORD),
        role: 'player',
        createdAt: now,
      };
      db.users.push(user);
      usersCreated++;
    } else {
      user.name = participant.name;
      user.username = participant.username;
      if (participant.username !== 'vagmachado') user.email = email;
      user.passwordHash ||= hashPassword(DEFAULT_PASSWORD);
      user.role ||= 'player';
      user.createdAt ||= now;
      usersUpdated++;
    }

    participantIds.add(user.id);
    planned.push({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      syncAuth: participant.username !== 'vagmachado',
    });

    const membership = db.memberships.find(
      (candidate) => candidate.poolId === pool.id && candidate.userId === user.id,
    );
    if (!membership) {
      db.memberships.push({ poolId: pool.id, userId: user.id, joinedAt: now });
      membershipsCreated++;
    }
  }

  const predictionIdsToClear = new Set([...participantIds, ...legacyMvpIds]);
  const predictionsBefore = db.predictions.length;
  db.predictions = db.predictions.filter(
    (prediction) => prediction.poolId !== pool.id || !predictionIdsToClear.has(prediction.userId),
  );

  return {
    store: store.kind,
    poolId: pool.id,
    participants: participants.length,
    usersCreated,
    usersUpdated,
    membershipsCreated,
    predictionsRemoved: predictionsBefore - db.predictions.length,
    password: DEFAULT_PASSWORD,
  };
});

for (const user of planned) {
  if (!user.syncAuth) {
    authSummary.skipped++;
    continue;
  }
  const result = await upsertAuthUser(user);
  authSummary[result]++;
}

console.log(JSON.stringify({ ...summary, auth: authSummary }, null, 2));
