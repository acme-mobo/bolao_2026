import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { ApiFootballClient } from '../src/api-football.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body, options = {}) {
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('ApiFootballClient conta request quando recebe resposta HTTP com sucesso', async () => {
  globalThis.fetch = async () => jsonResponse({ response: [] });

  const client = new ApiFootballClient({
    apiKey: 'test-key',
    leagueId: 1,
    season: 2030,
  });

  const fixtures = await client.fetchDailyFixtures('2030-06-09');

  assert.deepEqual(fixtures, []);
  assert.equal(client.requestCount, 1);
});

test('ApiFootballClient conta request quando a API retorna erro HTTP', async () => {
  globalThis.fetch = async () => jsonResponse(
    { errors: { plan: 'quota exceeded' } },
    { status: 429 },
  );

  const client = new ApiFootballClient({ apiKey: 'test-key' });

  await assert.rejects(
    () => client.fetchStandings(),
    /API-Football HTTP 429/,
  );
  assert.equal(client.requestCount, 1);
});

test('ApiFootballClient nao conta request quando fetch falha antes de resposta HTTP', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  const client = new ApiFootballClient({ apiKey: 'test-key' });

  await assert.rejects(
    () => client.fetchLiveFixtures(),
    /fetch failed/,
  );
  assert.equal(client.requestCount, 0);
});
