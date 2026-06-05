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

test('sincroniza resultado via provider de live score', async () => {
  const fakeProvider = {
    getStatus() {
      return { provider: 'fake-live-score', configured: true };
    },
    async fetchMatches() {
      return [
        {
          externalId: '1001',
          status: 'finished',
          homeTeamCode: 'MEX',
          awayTeamCode: 'RSA',
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
