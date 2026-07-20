import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createToken } from '../src/auth.js';
import { createRouter } from '../src/routes.js';
import { Store } from '../src/store.js';

const TEST_TEAMS = [
  { id: 'team_ALF', name: 'Time Alfa', code: 'ALF', group: 'A' },
  { id: 'team_BET', name: 'Time Beta', code: 'BET', group: 'A' },
  { id: 'team_GAM', name: 'Time Gama', code: 'GAM', group: 'B' },
  { id: 'team_DEL', name: 'Time Delta', code: 'DEL', group: 'B' },
];

const TEST_MATCHES = [
  { matchNumber: 1, group: 'A', homeCode: 'ALF', awayCode: 'BET', startsAt: '2030-06-11T19:00:00.000Z' },
  { matchNumber: 2, group: 'A', homeCode: 'BET', awayCode: 'ALF', startsAt: '2030-06-11T22:00:00.000Z' },
  { matchNumber: 3, group: 'B', homeCode: 'GAM', awayCode: 'DEL', startsAt: '2030-06-12T19:00:00.000Z' },
];

function createMockResponse() {
  const response = new EventEmitter();
  response.headers = {};
  response.statusCode = 200;
  response.setHeader = (name, value) => {
    response.headers[name.toLowerCase()] = value;
  };
  response.end = (payload = '') => {
    response.payload = payload;
    response.emit('finish');
  };
  return response;
}

async function createApi(options = {}) {
  const store = new Store(path.join(os.tmpdir(), `bolao-${Date.now()}-${Math.random()}.json`));
  await store.load();
  return { store, router: createRouter(store, options) };
}

async function request(api, path, options = {}) {
  const requestBody = options.body ?? '';
  const request = Readable.from(requestBody ? [Buffer.from(requestBody)] : []);
  request.method = options.method ?? 'GET';
  request.url = path;
  request.headers = {
    host: 'localhost',
    'content-type': 'application/json',
    ...(options.headers ?? {}),
  };

  const response = createMockResponse();
  const finished = new Promise((resolve) => response.once('finish', resolve));
  await api.router(request, response);
  await finished;

  return {
    status: response.statusCode,
    headers: response.headers,
    body: response.payload ? JSON.parse(response.payload) : undefined,
  };
}

test('registra, cria bolao e lista leaderboard', async () => {
  const api = await createApi();
  let result = await request(api, '/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Vagner', email: 'vagner@example.com', password: '12345678' }),
  });
  assert.equal(result.status, 201);
  const token = result.body.token;

  result = await request(api, '/pools', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Bolao da firma' }),
  });
  assert.equal(result.status, 201);

  result = await request(api, `/pools/${result.body.pool.id}/leaderboard`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.leaderboard[0].name, 'Vagner');
});

test('respostas da API interna nao ficam em cache', async () => {
  const api = await createApi();

  const result = await request(api, '/teams');

  assert.equal(result.status, 200);
  assert.equal(result.headers['cache-control'], 'no-store, max-age=0');
});

test('matches publicos usam cache curto', async () => {
  const api = await createApi();

  const matches = await request(api, '/matches');
  const summary = await request(api, '/matches/summary');

  assert.equal(matches.status, 200);
  assert.equal(matches.headers['cache-control'], 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  assert.equal(summary.status, 200);
  assert.equal(summary.headers['cache-control'], 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
});

test('matches em janela live usam cache menor e fresh ignora cache', async () => {
  const api = await createApi();
  await api.store.transaction((db) => {
    db.matches = [
      {
        id: 'match_live_window',
        matchNumber: 1,
        startsAt: new Date(Date.now() - 30 * 60_000).toISOString(),
        status: 'live',
        homeGoals: 2,
        awayGoals: 1,
      },
    ];
  });

  const live = await request(api, '/matches');
  const fresh = await request(api, '/matches?fresh=1');

  assert.equal(live.headers['cache-control'], 'public, max-age=0, s-maxage=10, stale-while-revalidate=15');
  assert.equal(fresh.headers['cache-control'], 'no-store, max-age=0');
});

test('matches carregam somente colecoes necessarias quando store suporta leitura parcial', async () => {
  const calls = [];
  const store = {
    db: {
      matches: [
        {
          id: 'match_1',
          matchNumber: 1,
          homeTeamId: 'team_ALF',
          awayTeamId: 'team_BET',
          status: 'scheduled',
          homeGoals: null,
          awayGoals: null,
        },
      ],
      teams: [
        { id: 'team_ALF', name: 'Time Alfa', code: 'ALF' },
        { id: 'team_BET', name: 'Time Beta', code: 'BET' },
      ],
    },
    async load() {
      calls.push({ type: 'load' });
      return this.db;
    },
    async loadCollections(collections) {
      calls.push({ type: 'loadCollections', collections });
      return {
        users: [],
        teams: collections.includes('teams') ? this.db.teams : [],
        matches: collections.includes('matches') ? this.db.matches : [],
        pools: [],
        memberships: [],
        predictions: [],
        standings: [],
      };
    },
  };
  const api = { store, router: createRouter(store) };

  await request(api, '/matches');
  await request(api, '/matches/summary');

  assert.deepEqual(calls, [
    { type: 'loadCollections', collections: ['matches'] },
    { type: 'loadCollections', collections: ['matches', 'teams'] },
  ]);
});

test('retorna bolao ativo e inclui usuario automaticamente', async () => {
  const api = await createApi();
  const register = await request(api, '/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Vagner', email: 'vagner-active@example.com', password: '12345678' }),
  });

  const active = await request(api, '/pools/active', {
    headers: { authorization: `Bearer ${register.body.token}` },
  });

  assert.equal(active.status, 200);
  assert.equal(active.body.pool.id, 'pool_main');
  assert.equal(active.body.pool.name, 'Bolao Principal');
  assert.equal(
    api.store.db.memberships.some(
      (membership) => membership.poolId === 'pool_main' && membership.userId === register.body.user.id,
    ),
    true,
  );
});

test('summary agrega partidas pela data local de Sao Paulo', async () => {
  const api = await createApi();
  await api.store.transaction((db) => {
    db.teams = TEST_TEAMS;
    db.matches = TEST_MATCHES.map(
      ({ matchNumber, group, homeCode, awayCode, startsAt }) => ({
        id: `match_${matchNumber}`,
        matchNumber,
        homeTeamId: `team_${homeCode}`,
        awayTeamId: `team_${awayCode}`,
        stage: 'group',
        group,
        startsAt,
        lockAt: startsAt,
        venue: null,
        city: null,
        status: 'scheduled',
        homeGoals: null,
        awayGoals: null,
        createdAt: '2030-06-01T00:00:00.000Z',
      }),
    );
  });

  const june11 = await request(api, '/matches/summary?date=2030-06-11');
  assert.equal(june11.status, 200);
  assert.deepEqual(Object.keys(june11.body), ['matches']);
  assert.deepEqual(june11.body.matches, [
    {
      matchNumber: 1,
      status: 'scheduled',
      homeTeam: 'Time Alfa',
      awayTeam: 'Time Beta',
      homeCode: 'ALF',
      awayCode: 'BET',
      homeGoals: null,
      awayGoals: null,
    },
    {
      matchNumber: 2,
      status: 'scheduled',
      homeTeam: 'Time Beta',
      awayTeam: 'Time Alfa',
      homeCode: 'BET',
      awayCode: 'ALF',
      homeGoals: null,
      awayGoals: null,
    },
  ]);

  const june12 = await request(api, '/matches/summary?date=2030-06-12');
  assert.equal(june12.status, 200);
  assert.deepEqual(Object.keys(june12.body), ['matches']);
  assert.deepEqual(june12.body.matches.map((match) => match.matchNumber), [3]);

  const all = await request(api, '/matches/summary');
  assert.equal(all.status, 200);
  assert.deepEqual(Object.keys(all.body), ['matches']);
  assert.deepEqual(all.body.matches.map((match) => match.matchNumber), [1, 2, 3]);
});

test('groups inclui tabela quando standings foram sincronizados', async () => {
  const api = await createApi();
  await api.store.transaction((db) => {
    db.teams = TEST_TEAMS.slice(0, 2);
    db.matches = [];
    db.standings = [
      {
        id: 'A_9025',
        group: 'A',
        rank: 2,
        teamId: '9025',
        teamCode: 'ALF',
        teamName: 'Time Alfa',
        points: 4,
        played: 2,
        won: 1,
        drawn: 1,
        lost: 0,
        goalsFor: 3,
        goalsAgainst: 1,
        goalsDiff: 2,
      },
      {
        id: 'A_9287',
        group: 'A',
        rank: 1,
        teamId: '9287',
        teamCode: 'BET',
        teamName: 'Time Beta',
        points: 6,
        played: 2,
        won: 2,
        drawn: 0,
        lost: 0,
        goalsFor: 4,
        goalsAgainst: 1,
        goalsDiff: 3,
      },
    ];
  });

  const response = await request(api, '/groups');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.groups[0].table.map((team) => team.teamCode), ['BET', 'ALF']);
  assert.equal(response.body.groups[0].table[0].points, 6);
});

test('predictions reconhece palpites salvos com id legado do jogo', async () => {
  const api = await createApi();
  const register = await request(api, '/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Vagner', email: 'legacy-pred@example.com', password: '12345678' }),
  });
  const token = register.body.token;
  const userId = register.body.user.id;

  await api.store.transaction((db) => {
    db.teams = [
      { id: 'team_ALF', name: 'Time Alfa', code: 'ALF', group: 'A' },
      { id: 'team_BET', name: 'Time Beta', code: 'BET', group: 'A' },
    ];
    db.matches = [
      {
        id: 'current_match_1',
        matchNumber: 1,
        homeTeamId: 'team_ALF',
        awayTeamId: 'team_BET',
        stage: 'group',
        group: 'A',
        startsAt: '2099-06-11T19:00:00.000Z',
        lockAt: '2099-06-11T19:00:00.000Z',
        status: 'scheduled',
        homeGoals: null,
        awayGoals: null,
      },
    ];
    db.pools = [{ id: 'pool_main', name: 'Bolao Principal', ownerId: userId, isActive: true }];
    db.memberships = [{ poolId: 'pool_main', userId, joinedAt: '2030-06-01T00:00:00.000Z' }];
    db.predictions = [
      {
        id: 'pred_legacy',
        poolId: 'pool_main',
        userId,
        matchId: 'match_1',
        homeGoals: 2,
        awayGoals: 1,
      },
    ];
  });

  const list = await request(api, '/pools/pool_main/predictions', {
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(list.status, 200);
  assert.equal(list.body.predictions[0].matchId, 'current_match_1');
  assert.equal(list.body.predictions[0].legacyMatchId, 'match_1');

  const update = await request(api, '/pools/pool_main/predictions', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ matchId: 'current_match_1', homeGoals: 3, awayGoals: 0 }),
  });

  assert.equal(update.status, 200);
  assert.equal(api.store.db.predictions.length, 1);
  assert.equal(api.store.db.predictions[0].matchId, 'current_match_1');
  assert.equal(api.store.db.predictions[0].homeGoals, 3);
});

test('router mantem transacao de palpite isolada de loads concorrentes', async () => {
  let releaseTransaction;
  let transactionStarted;
  const transactionStartedPromise = new Promise((resolve) => {
    transactionStarted = resolve;
  });
  const releaseTransactionPromise = new Promise((resolve) => {
    releaseTransaction = resolve;
  });

  const user = { id: 'usr_race', name: 'Vagner', email: 'race@example.com', role: 'player' };
  const fullDb = {
    users: [user],
    teams: [
      { id: 'team_ALF', name: 'Time Alfa', code: 'ALF', group: 'A' },
      { id: 'team_BET', name: 'Time Beta', code: 'BET', group: 'A' },
    ],
    matches: [
      {
        id: 'match_1',
        matchNumber: 1,
        homeTeamId: 'team_ALF',
        awayTeamId: 'team_BET',
        stage: 'group',
        group: 'A',
        startsAt: '2099-06-11T19:00:00.000Z',
        lockAt: '2099-06-11T19:00:00.000Z',
        status: 'scheduled',
        homeGoals: null,
        awayGoals: null,
      },
    ],
    pools: [{ id: 'pool_main', name: 'Bolao Principal', ownerId: user.id, isActive: true }],
    memberships: [{ poolId: 'pool_main', userId: user.id, joinedAt: '2030-06-01T00:00:00.000Z' }],
    predictions: [],
    standings: [],
  };
  const emptyDb = () => ({
    users: [],
    teams: [],
    matches: [],
    pools: [],
    memberships: [],
    predictions: [],
    standings: [],
  });
  const store = {
    db: emptyDb(),
    lock: Promise.resolve(),
    async withLock(callback) {
      const previous = this.lock;
      let release;
      this.lock = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback();
      } finally {
        release();
      }
    },
    async loadCollections(collections) {
      const nextDb = emptyDb();
      for (const collection of collections) {
        nextDb[collection] = fullDb[collection].map((item) => ({ ...item }));
      }
      this.db = nextDb;
      return this.db;
    },
    async load() {
      this.db = Object.fromEntries(
        Object.entries(fullDb).map(([collection, items]) => [collection, items.map((item) => ({ ...item }))]),
      );
      return this.db;
    },
    async save() {},
    async transaction(mutator) {
      transactionStarted();
      await releaseTransactionPromise;
      const result = mutator(this.db);
      return result instanceof Promise ? result : Promise.resolve(result);
    },
  };
  const api = { store, router: createRouter(store) };
  const token = createToken(user);

  const postPromise = request(api, '/pools/pool_main/predictions', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ matchId: 'match_1', homeGoals: 2, awayGoals: 1 }),
  });
  await transactionStartedPromise;
  const matchesPromise = request(api, '/matches');

  releaseTransaction();
  const [post, matches] = await Promise.all([postPromise, matchesPromise]);

  assert.equal(post.status, 200);
  assert.equal(post.body.prediction.matchId, 'match_1');
  assert.equal(matches.status, 200);
});

test('predictions bloqueia apostas nos 5 minutos antes do inicio', async () => {
  const api = await createApi();
  const register = await request(api, '/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Vagner', email: 'lock-window@example.com', password: '12345678' }),
  });
  const token = register.body.token;
  const userId = register.body.user.id;
  const startsAt = new Date(Date.now() + 4 * 60_000).toISOString();

  await api.store.transaction((db) => {
    db.teams = [
      { id: 'team_ALF', name: 'Time Alfa', code: 'ALF', group: 'A' },
      { id: 'team_BET', name: 'Time Beta', code: 'BET', group: 'A' },
    ];
    db.matches = [
      {
        id: 'match_1',
        matchNumber: 1,
        homeTeamId: 'team_ALF',
        awayTeamId: 'team_BET',
        stage: 'group',
        group: 'A',
        startsAt,
        lockAt: startsAt,
        status: 'scheduled',
        homeGoals: null,
        awayGoals: null,
      },
    ];
    db.pools = [{ id: 'pool_main', name: 'Bolao Principal', ownerId: userId, isActive: true }];
    db.memberships = [{ poolId: 'pool_main', userId, joinedAt: '2030-06-01T00:00:00.000Z' }];
  });

  await assert.rejects(
    () => request(api, '/pools/pool_main/predictions', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ matchId: 'match_1', homeGoals: 2, awayGoals: 0 }),
    }),
    (error) => error.status === 409 && error.message === 'Palpites encerrados para este jogo',
  );
});

test('predictions bloqueia apostas em jogo de mata-mata sem times definidos', async () => {
  const api = await createApi();
  const register = await request(api, '/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Vagner', email: 'undefined-knockout@example.com', password: '12345678' }),
  });
  const token = register.body.token;
  const userId = register.body.user.id;
  const startsAt = new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString();

  await api.store.transaction((db) => {
    db.matches = [
      {
        id: 'match_90',
        matchNumber: 90,
        homeTeamId: null,
        awayTeamId: null,
        homeSlot: 'Vencedor Jogo 73',
        awaySlot: 'Vencedor Jogo 75',
        stage: 'round-of-16',
        group: null,
        startsAt,
        lockAt: startsAt,
        status: 'scheduled',
        homeGoals: null,
        awayGoals: null,
      },
    ];
    db.pools = [{ id: 'pool_main', name: 'Bolao Principal', ownerId: userId, isActive: true }];
    db.memberships = [{ poolId: 'pool_main', userId, joinedAt: '2030-06-01T00:00:00.000Z' }];
  });

  await assert.rejects(
    () => request(api, '/pools/pool_main/predictions', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ matchId: 'match_90', homeGoals: 2, awayGoals: 1 }),
    }),
    (error) => error.status === 409 && error.message === 'Jogo ainda sem times definidos para apostas',
  );
});

test('leaderboard recalcula pontos com placar de jogo em andamento', async () => {
  const api = await createApi();
  const register = await request(api, '/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Vagner', email: 'live-rank@example.com', password: '12345678' }),
  });
  const token = register.body.token;
  const userId = register.body.user.id;

  await api.store.transaction((db) => {
    db.teams = [
      { id: 'team_ALF', name: 'Time Alfa', code: 'ALF', group: 'A' },
      { id: 'team_BET', name: 'Time Beta', code: 'BET', group: 'A' },
    ];
    db.matches = [
      {
        id: 'match_1',
        matchNumber: 1,
        homeTeamId: 'team_ALF',
        awayTeamId: 'team_BET',
        stage: 'group',
        group: 'A',
        startsAt: '2030-06-11T19:00:00.000Z',
        lockAt: '2030-06-11T19:00:00.000Z',
        status: 'live',
        homeGoals: 1,
        awayGoals: 0,
      },
    ];
    db.pools = [{ id: 'pool_main', name: 'Bolao Principal', ownerId: userId, isActive: true }];
    db.memberships = [{ poolId: 'pool_main', userId, joinedAt: '2030-06-01T00:00:00.000Z' }];
    db.predictions = [
      {
        id: 'pred_live',
        poolId: 'pool_main',
        userId,
        matchId: 'match_1',
        homeGoals: 1,
        awayGoals: 0,
      },
    ];
  });

  const response = await request(api, '/pools/pool_main/leaderboard', {
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.leaderboard[0].points, 5);
  assert.equal(response.body.leaderboard[0].exactCount, 1);
});

test('palpites dos jogadores ficam visiveis em jogo ao vivo', async () => {
  const api = await createApi();
  const register = await request(api, '/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Vagner', email: 'live-preds@example.com', password: '12345678' }),
  });
  const token = register.body.token;
  const userId = register.body.user.id;

  await api.store.transaction((db) => {
    db.teams = [
      { id: 'team_ALF', name: 'Time Alfa', code: 'ALF', group: 'A' },
      { id: 'team_BET', name: 'Time Beta', code: 'BET', group: 'A' },
    ];
    db.matches = [
      {
        id: 'match_1',
        matchNumber: 1,
        homeTeamId: 'team_ALF',
        awayTeamId: 'team_BET',
        stage: 'group',
        group: 'A',
        startsAt: '2030-06-11T19:00:00.000Z',
        lockAt: '2030-06-11T19:00:00.000Z',
        status: 'live',
        homeGoals: 1,
        awayGoals: 0,
      },
    ];
    db.pools = [{ id: 'pool_main', name: 'Bolao Principal', ownerId: userId, isActive: true }];
    db.memberships = [{ poolId: 'pool_main', userId, joinedAt: '2030-06-01T00:00:00.000Z' }];
    db.predictions = [
      {
        id: 'pred_live',
        poolId: 'pool_main',
        userId,
        matchId: 'match_1',
        homeGoals: 1,
        awayGoals: 0,
      },
    ];
  });

  const response = await request(api, '/pools/pool_main/matches/match_1/predictions', {
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.predictions.length, 1);
  assert.equal(response.body.predictions[0].points, 5);
});

test('sincroniza resultado via provider de live score', async () => {
  const fakeProvider = {
    getStatus() {
      return { provider: 'fake-live-score', configured: true };
    },
    async fetchLiveFixtures() {
      return [
        {
          externalId: '1001',
          status: 'finished',
          homeCode: 'ALF',
          awayCode: 'BET',
          homeGoals: 2,
          awayGoals: 0,
          lastUpdated: '2030-06-11T21:00:00.000Z',
        },
      ];
    },
  };
  const api = await createApi({ liveScoreProvider: fakeProvider });
  await api.store.transaction((db) => {
    db.teams = TEST_TEAMS;
    db.matches = TEST_MATCHES.slice(0, 1).map(({ matchNumber, group, homeCode, awayCode, startsAt }) => ({
      id: 'match_1',
      matchNumber,
      homeTeamId: `team_${homeCode}`,
      awayTeamId: `team_${awayCode}`,
      stage: 'group',
      group,
      startsAt,
      lockAt: startsAt,
      status: 'scheduled',
      homeGoals: null,
      awayGoals: null,
      createdAt: '2030-06-01T00:00:00.000Z',
    }));
  });

  const register = await request(api, '/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Admin', email: 'admin@example.com', password: '12345678' }),
  });

  const result = await request(api, '/live-score/sync', {
    method: 'POST',
    headers: { authorization: `Bearer ${register.body.token}` },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.updated, 1);
  assert.equal(api.store.db.matches[0].status, 'finished');
  assert.equal(api.store.db.matches[0].homeGoals, 2);
  assert.equal(api.store.db.matches[0].awayGoals, 0);
  assert.equal(api.store.db.matches[0].externalMatchId, '1001');
});
