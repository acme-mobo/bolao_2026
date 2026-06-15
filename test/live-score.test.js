import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  ApiFootballLiveScoreProvider,
  FootballDataLiveScoreProvider,
  LiveScoreLiveScoreProvider,
  applyLiveFixturesToDb,
  createLiveScoreProvider,
} from '../src/live-score.js';
import { config } from '../src/config.js';

const originalFetch = globalThis.fetch;
const originalLiveScoreProvider = config.liveScoreProvider;

afterEach(() => {
  globalThis.fetch = originalFetch;
  config.liveScoreProvider = originalLiveScoreProvider;
});

function jsonResponse(body, options = {}) {
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('createLiveScoreProvider usa API-Football por configuracao', () => {
  config.liveScoreProvider = 'api-football';

  const provider = createLiveScoreProvider({ apiKey: 'test-key' });

  assert.equal(provider instanceof ApiFootballLiveScoreProvider, true);
  assert.equal(provider.getStatus().provider, 'api-football');
  assert.equal(provider.quotaBucket, 'api-football');
});

test('createLiveScoreProvider usa football-data por configuracao', () => {
  config.liveScoreProvider = 'football-data';

  const provider = createLiveScoreProvider({ token: 'test-token' });

  assert.equal(provider instanceof FootballDataLiveScoreProvider, true);
  assert.equal(provider.getStatus().provider, 'football-data.org');
  assert.equal(provider.quotaBucket, null);
});

test('createLiveScoreProvider usa LiveScore por configuracao', () => {
  config.liveScoreProvider = 'livescore';

  const provider = createLiveScoreProvider({ fixturesUrl: 'https://www.livescore.com/pt/futebol/international/world-cup-2026/fixtures/' });

  assert.equal(provider instanceof LiveScoreLiveScoreProvider, true);
  assert.equal(provider.getStatus().provider, 'livescore');
  assert.equal(provider.quotaBucket, null);
});

test('createLiveScoreProvider falha com provider invalido', () => {
  config.liveScoreProvider = 'unknown';

  assert.throws(
    () => createLiveScoreProvider(),
    /LIVE_SCORE_PROVIDER invalido: unknown/,
  );
});

test('applyLiveFixturesToDb atualiza partida local com fixture do LiveScore', () => {
  const db = {
    teams: [
      { id: 'team_MEX', code: 'MEX' },
      { id: 'team_RSA', code: 'RSA' },
    ],
    matches: [
      {
        id: 'match_1',
        matchNumber: 1,
        homeTeamId: 'team_MEX',
        awayTeamId: 'team_RSA',
        status: 'scheduled',
        homeGoals: null,
        awayGoals: null,
      },
    ],
  };

  const result = applyLiveFixturesToDb(
    db,
    [
      {
        externalId: '1417909',
        status: 'finished',
        homeCode: 'MEX',
        awayCode: 'RSA',
        homeGoals: 2,
        awayGoals: 0,
        updatedAt: '2026-06-11T21:00:00.000Z',
      },
    ],
    { provider: 'livescore', configured: true },
  );

  assert.equal(result.updated, 1);
  assert.equal(db.matches[0].status, 'finished');
  assert.equal(db.matches[0].homeGoals, 2);
  assert.equal(db.matches[0].awayGoals, 0);
  assert.equal(db.matches[0].externalMatchId, '1417909');
  assert.equal(db.matches[0].externalProvider, 'livescore');
});

test('applyLiveFixturesToDb atualiza partida por externalMatchId quando siglas nao batem', () => {
  const db = {
    teams: [
      { id: 'team_MEX', code: 'XXX' },
      { id: 'team_RSA', code: 'YYY' },
    ],
    matches: [
      {
        id: 'match_1',
        matchNumber: 1,
        homeTeamId: 'team_MEX',
        awayTeamId: 'team_RSA',
        externalMatchId: '1417909',
        status: 'scheduled',
        homeGoals: null,
        awayGoals: null,
      },
    ],
  };

  const result = applyLiveFixturesToDb(
    db,
    [
      {
        externalId: '1417909',
        status: 'live',
        statusShort: 'HT',
        statusElapsed: null,
        homeCode: 'MEX',
        awayCode: 'RSA',
        homeGoals: 0,
        awayGoals: 0,
        updatedAt: '2026-06-11T19:05:00.000Z',
      },
    ],
    { provider: 'livescore', configured: true },
  );

  assert.equal(result.updated, 1);
  assert.equal(db.matches[0].status, 'live');
  assert.equal(db.matches[0].homeGoals, 0);
  assert.equal(db.matches[0].awayGoals, 0);
  assert.equal(db.matches[0].externalStatusShort, 'HT');
  assert.equal(db.matches[0].externalStatusElapsed, null);
});

test('FootballDataLiveScoreProvider normaliza fixtures para contrato comum', async () => {
  globalThis.fetch = async () => jsonResponse({
    matches: [
      {
        id: 1001,
        utcDate: '2026-06-11T19:00:00Z',
        status: 'FINISHED',
        homeTeam: { tla: 'MEX', name: 'Mexico' },
        awayTeam: { tla: 'RSA', name: 'Africa do Sul' },
        score: { fullTime: { home: 2, away: 0 } },
        lastUpdated: '2026-06-11T21:00:00Z',
      },
    ],
  });

  const provider = new FootballDataLiveScoreProvider({
    token: 'test-token',
    competitionCode: 'WC',
    season: 2026,
  });

  const fixtures = await provider.fetchLiveFixtures();

  assert.equal(provider.requestCount, 1);
  assert.deepEqual(fixtures, [
    {
      externalId: '1001',
      fixtureId: '1001',
      date: '2026-06-11T19:00:00Z',
      statusShort: 'FINISHED',
      statusElapsed: null,
      status: 'finished',
      round: null,
      group: null,
      venue: null,
      city: null,
      homeCode: 'MEX',
      awayCode: 'RSA',
      homeName: 'Mexico',
      awayName: 'Africa do Sul',
      homeLogo: null,
      awayLogo: null,
      homeGoals: 2,
      awayGoals: 0,
      rawStatus: 'FINISHED',
      updatedAt: '2026-06-11T21:00:00Z',
    },
  ]);
});
