import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createRouter } from '../src/routes.js';
import { Store } from '../src/store.js';
import { worldCup2026GroupMatches, worldCup2026Teams } from '../src/world-cup-2026-data.js';

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
  const store = new Store(path.join(os.tmpdir(), `bolao26-${Date.now()}-${Math.random()}.json`));
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
  assert.equal(active.body.pool.id, 'pool_copa_2026');
  assert.equal(active.body.pool.name, 'Bolao Copa 2026');
  assert.equal(
    api.store.db.memberships.some(
      (membership) => membership.poolId === 'pool_copa_2026' && membership.userId === register.body.user.id,
    ),
    true,
  );
});

test('summary agrega partidas pela data local de Sao Paulo', async () => {
  const api = await createApi();
  await api.store.transaction((db) => {
    db.teams = worldCup2026Teams.map(([name, code, group]) => ({ id: `team_${code}`, name, code, group }));
    db.matches = worldCup2026GroupMatches.slice(0, 3).map(
      ([matchNumber, group, homeCode, awayCode, startsAt, venue, city]) => ({
        id: `match_${matchNumber}`,
        matchNumber,
        homeTeamId: `team_${homeCode}`,
        awayTeamId: `team_${awayCode}`,
        stage: 'group',
        group,
        startsAt,
        lockAt: startsAt,
        venue,
        city,
        status: 'scheduled',
        homeGoals: null,
        awayGoals: null,
        createdAt: '2026-06-01T00:00:00.000Z',
      }),
    );
  });

  const june11 = await request(api, '/matches/summary?date=2026-06-11');
  assert.equal(june11.status, 200);
  assert.deepEqual(Object.keys(june11.body), ['matches']);
  assert.deepEqual(june11.body.matches, [
    {
      matchNumber: 1,
      status: 'scheduled',
      homeTeam: 'Mexico',
      awayTeam: 'Africa do Sul',
      homeCode: 'MEX',
      awayCode: 'RSA',
      homeGoals: null,
      awayGoals: null,
    },
    {
      matchNumber: 2,
      status: 'scheduled',
      homeTeam: 'Coreia do Sul',
      awayTeam: 'Tchequia',
      homeCode: 'KOR',
      awayCode: 'CZE',
      homeGoals: null,
      awayGoals: null,
    },
  ]);

  const june12 = await request(api, '/matches/summary?date=2026-06-12');
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
    db.teams = worldCup2026Teams.slice(0, 2).map(([name, code, group]) => ({ id: `team_${code}`, name, code, group }));
    db.matches = [];
    db.standings = [
      {
        id: 'A_9025',
        group: 'A',
        rank: 2,
        teamId: '9025',
        teamCode: 'MEX',
        teamName: 'México',
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
        teamCode: 'RSA',
        teamName: 'África do Sul',
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
  assert.deepEqual(response.body.groups[0].table.map((team) => team.teamCode), ['RSA', 'MEX']);
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
      { id: 'team_MEX', name: 'Mexico', code: 'MEX', group: 'A' },
      { id: 'team_RSA', name: 'Africa do Sul', code: 'RSA', group: 'A' },
    ];
    db.matches = [
      {
        id: 'current_match_1',
        matchNumber: 1,
        homeTeamId: 'team_MEX',
        awayTeamId: 'team_RSA',
        stage: 'group',
        group: 'A',
        startsAt: '2099-06-11T19:00:00.000Z',
        lockAt: '2099-06-11T19:00:00.000Z',
        status: 'scheduled',
        homeGoals: null,
        awayGoals: null,
      },
    ];
    db.pools = [{ id: 'pool_copa_2026', name: 'Bolao Copa 2026', ownerId: userId, isActive: true }];
    db.memberships = [{ poolId: 'pool_copa_2026', userId, joinedAt: '2026-06-01T00:00:00.000Z' }];
    db.predictions = [
      {
        id: 'pred_legacy',
        poolId: 'pool_copa_2026',
        userId,
        matchId: 'match_1',
        homeGoals: 2,
        awayGoals: 1,
      },
    ];
  });

  const list = await request(api, '/pools/pool_copa_2026/predictions', {
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(list.status, 200);
  assert.equal(list.body.predictions[0].matchId, 'current_match_1');
  assert.equal(list.body.predictions[0].legacyMatchId, 'match_1');

  const update = await request(api, '/pools/pool_copa_2026/predictions', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ matchId: 'current_match_1', homeGoals: 3, awayGoals: 0 }),
  });

  assert.equal(update.status, 200);
  assert.equal(api.store.db.predictions.length, 1);
  assert.equal(api.store.db.predictions[0].matchId, 'current_match_1');
  assert.equal(api.store.db.predictions[0].homeGoals, 3);
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
      { id: 'team_MEX', name: 'Mexico', code: 'MEX', group: 'A' },
      { id: 'team_RSA', name: 'Africa do Sul', code: 'RSA', group: 'A' },
    ];
    db.matches = [
      {
        id: 'match_1',
        matchNumber: 1,
        homeTeamId: 'team_MEX',
        awayTeamId: 'team_RSA',
        stage: 'group',
        group: 'A',
        startsAt: '2026-06-11T19:00:00.000Z',
        lockAt: '2026-06-11T19:00:00.000Z',
        status: 'live',
        homeGoals: 1,
        awayGoals: 0,
      },
    ];
    db.pools = [{ id: 'pool_copa_2026', name: 'Bolao Copa 2026', ownerId: userId, isActive: true }];
    db.memberships = [{ poolId: 'pool_copa_2026', userId, joinedAt: '2026-06-01T00:00:00.000Z' }];
    db.predictions = [
      {
        id: 'pred_live',
        poolId: 'pool_copa_2026',
        userId,
        matchId: 'match_1',
        homeGoals: 1,
        awayGoals: 0,
      },
    ];
  });

  const response = await request(api, '/pools/pool_copa_2026/leaderboard', {
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.leaderboard[0].points, 25);
  assert.equal(response.body.leaderboard[0].exactCount, 1);
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
          homeCode: 'MEX',
          awayCode: 'RSA',
          homeGoals: 2,
          awayGoals: 0,
          lastUpdated: '2026-06-11T21:00:00.000Z',
        },
      ];
    },
  };
  const api = await createApi({ liveScoreProvider: fakeProvider });
  await api.store.transaction((db) => {
    db.teams = worldCup2026Teams.map(([name, code, group]) => ({ id: `team_${code}`, name, code, group }));
    db.matches = worldCup2026GroupMatches.slice(0, 1).map(([matchNumber, group, homeCode, awayCode, startsAt]) => ({
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
      createdAt: '2026-06-01T00:00:00.000Z',
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
