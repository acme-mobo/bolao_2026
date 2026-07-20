import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  buildSyncLogEntry,
  buildCompactSyncResponse,
  buildSyncResponse,
  getApiFootballDailyBudget,
  getApiFootballCapabilities,
  getDailySyncSource,
  getStandingsSyncSource,
  getLiveSyncInterval,
  getLocalFixturesForDate,
  shouldTrackApiFootballQuota,
  hasApiFootballBudget,
  hasKnownTodayMatches,
  isInsideLiveWindow,
  shouldRunLiveSync,
} from '../src/competition-sync.js';
import { config } from '../src/config.js';

const originalBudget = config.apiFootballSyncDailyBudget;

afterEach(() => {
  config.apiFootballSyncDailyBudget = originalBudget;
});

test('plano free bloqueia endpoints por temporada mas permite fixtures por data', () => {
  const capabilities = getApiFootballCapabilities({ plan: 'free', season: 2030 });

  assert.equal(capabilities.canSyncSeasonFixtures, false);
  assert.equal(capabilities.canSyncStandings, false);
  assert.equal(capabilities.canSyncDailyFixtures, true);
  assert.equal(capabilities.canSyncLive, true);
  assert.match(capabilities.seasonUnsupportedReason, /Free.*season=2030/);
});

test('plano paid libera sync completo da competição', () => {
  const capabilities = getApiFootballCapabilities({ plan: 'paid', season: 2030 });

  assert.equal(capabilities.canSyncSeasonFixtures, true);
  assert.equal(capabilities.canSyncStandings, true);
  assert.equal(capabilities.canSyncDailyFixtures, true);
  assert.equal(capabilities.canSyncLive, true);
});

test('quota diaria rastreia apenas fontes API-Football', () => {
  assert.equal(shouldTrackApiFootballQuota({ quotaBucket: 'api-football' }), true);
  assert.equal(shouldTrackApiFootballQuota({ quotaBucket: null }), false);
  assert.equal(shouldTrackApiFootballQuota({}), true);
});

test('daily usa provider sem quota API-Football quando configurado', () => {
  const client = { configured: true };
  const liveProvider = {
    configured: true,
    quotaBucket: null,
    getStatus() {
      return { provider: 'livescore' };
    },
  };

  const source = getDailySyncSource(client, liveProvider);

  assert.equal(source.type, 'live-provider');
  assert.equal(source.source, liveProvider);
  assert.equal(source.provider, 'livescore');
  assert.equal(source.tracksApiFootball, false);
});

test('daily mantem API-Football quando live provider tambem usa API-Football', () => {
  const client = { configured: true };
  const liveProvider = {
    configured: true,
    quotaBucket: 'api-football',
    getStatus() {
      return { provider: 'api-football' };
    },
  };

  const source = getDailySyncSource(client, liveProvider);

  assert.equal(source.type, 'api-football');
  assert.equal(source.source, client);
  assert.equal(source.provider, 'api-football');
  assert.equal(source.tracksApiFootball, true);
});

test('standings usa provider sem quota quando ele suporta tabela', () => {
  const client = { configured: true };
  const liveProvider = {
    configured: true,
    quotaBucket: null,
    fetchStandings() {},
    getStatus() {
      return { provider: 'livescore' };
    },
  };

  const source = getStandingsSyncSource(client, liveProvider);

  assert.equal(source.source, liveProvider);
  assert.equal(source.provider, 'livescore');
  assert.equal(source.tracksApiFootball, false);
});

test('standings volta para API-Football quando provider nao suporta tabela', () => {
  const client = { configured: true };
  const liveProvider = {
    configured: true,
    quotaBucket: null,
    getStatus() {
      return { provider: 'football-data.org' };
    },
  };

  const source = getStandingsSyncSource(client, liveProvider);

  assert.equal(source.source, client);
  assert.equal(source.provider, 'api-football');
  assert.equal(source.tracksApiFootball, true);
});

test('budget diario conservador limita chamadas antes do limite real', () => {
  assert.equal(getApiFootballDailyBudget({ budget: 60 }), 60);
  assert.equal(hasApiFootballBudget(59, 1, { budget: 60 }), true);
  assert.equal(hasApiFootballBudget(60, 1, { budget: 60 }), false);
  assert.equal(hasApiFootballBudget(58, 2, { budget: 60 }), true);
  assert.equal(hasApiFootballBudget(59, 2, { budget: 60 }), false);
});

test('budget invalido volta para limite diario real', () => {
  assert.equal(getApiFootballDailyBudget({ budget: 0 }), 100);
  assert.equal(getApiFootballDailyBudget({ budget: Number.NaN }), 100);
  assert.equal(getApiFootballDailyBudget({ budget: 150 }), 100);
});

test('calendario local identifica dias com e sem jogos conhecidos', () => {
  const fixtures = [{ fixtureId: 'match_1', date: '2030-06-11T19:00:00.000Z' }];
  const june10 = getLocalFixturesForDate('2030-06-10', fixtures);
  const june11 = getLocalFixturesForDate('2030-06-11', fixtures);

  assert.equal(hasKnownTodayMatches(june10), false);
  assert.equal(hasKnownTodayMatches(june11), true);
  assert.equal(june11[0].fixtureId, 'match_1');
});

test('janela de live considera uma hora antes ate tres horas depois', () => {
  const fixtures = [{ date: '2030-06-11T19:00:00.000Z' }];

  assert.equal(isInsideLiveWindow(fixtures, new Date('2030-06-11T17:59:59.000Z')), false);
  assert.equal(isInsideLiveWindow(fixtures, new Date('2030-06-11T18:00:00.000Z')), true);
  assert.equal(isInsideLiveWindow(fixtures, new Date('2030-06-11T22:00:00.000Z')), true);
  assert.equal(isInsideLiveWindow(fixtures, new Date('2030-06-11T22:00:01.000Z')), false);
});

test('janela de live ignora dias sem jogo conhecido', () => {
  assert.equal(isInsideLiveWindow([], new Date('2030-06-11T19:00:00.000Z')), false);
});

test('intervalo de live usa 3 minutos em jogo e janelas mais baratas fora dele', () => {
  const fixture = { date: '2030-06-11T19:00:00.000Z', status: 'scheduled' };

  assert.equal(getLiveSyncInterval([fixture], new Date('2030-06-11T18:20:00.000Z')), 10);
  assert.equal(getLiveSyncInterval([fixture], new Date('2030-06-11T18:50:00.000Z')), 5);
  assert.equal(getLiveSyncInterval([fixture], new Date('2030-06-11T19:30:00.000Z')), 3);
  assert.equal(getLiveSyncInterval([{ ...fixture, status: 'live' }], new Date('2030-06-11T20:00:00.000Z')), 3);
  assert.equal(getLiveSyncInterval([fixture], new Date('2030-06-11T22:00:00.000Z')), 10);
});

test('intervalo de live ignora jogos finalizados', () => {
  assert.equal(
    getLiveSyncInterval(
      [{ date: '2030-06-11T19:00:00.000Z', status: 'finished' }],
      new Date('2030-06-11T20:00:00.000Z'),
    ),
    null,
  );
});

test('force permite rodar live mesmo com lastLive fresco', () => {
  const recent = new Date().toISOString();

  assert.equal(shouldRunLiveSync({
    force: false,
    liveInterval: 10,
    lastLive: recent,
    hasMatchesToday: true,
    hasLiveNow: false,
    insideLiveWindow: true,
  }), false);

  assert.equal(shouldRunLiveSync({
    force: true,
    liveInterval: 10,
    lastLive: recent,
    hasMatchesToday: true,
    hasLiveNow: false,
    insideLiveWindow: true,
  }), true);
});

test('force manual roda live mesmo fora da janela local', () => {
  const recent = new Date().toISOString();

  assert.equal(shouldRunLiveSync({
    force: true,
    liveInterval: 10,
    lastLive: recent,
    hasMatchesToday: false,
    hasLiveNow: false,
    insideLiveWindow: false,
  }), true);
});

test('buildSyncLogEntry monta log resumido sem payload bruto', () => {
  const entry = buildSyncLogEntry({
    startedAt: '2030-06-09T18:00:00.000Z',
    finishedAt: '2030-06-09T18:00:02.500Z',
    mode: 'normal',
    plan: 'free',
    usedBefore: 7,
    usedAfter: 8,
    apiCallsMade: 1,
    status: 'ok',
    ops: [
      { op: 'daily', ok: true, count: 0, fixtures: [{ fixtureId: 1 }] },
      { op: 'standings', skipped: true, reason: 'indisponivel' },
    ],
  });

  assert.deepEqual(entry, {
    startedAt: '2030-06-09T18:00:00.000Z',
    finishedAt: '2030-06-09T18:00:02.500Z',
    durationMs: 2500,
    mode: 'normal',
    plan: 'free',
    usedBefore: 7,
    usedAfter: 8,
    apiCallsMade: 1,
    ops: [
      {
        op: 'daily',
        ok: true,
        skipped: false,
        count: 0,
        changes: null,
        matched: null,
        unmatchedExternalIds: null,
        provider: null,
        reason: null,
        error: null,
      },
      {
        op: 'standings',
        ok: false,
        skipped: true,
        count: null,
        changes: null,
        matched: null,
        unmatchedExternalIds: null,
        provider: null,
        reason: 'indisponivel',
        error: null,
      },
    ],
    status: 'ok',
    trigger: 'sync',
  });
});

test('buildSyncResponse destaca status, quota e resumo das operacoes', () => {
  config.apiFootballSyncDailyBudget = 60;

  const response = buildSyncResponse({
    startedAt: '2030-06-09T18:00:00.000Z',
    finishedAt: '2030-06-09T18:00:01.000Z',
    status: 'ok',
    mode: 'normal',
    plan: 'free',
    usedBefore: 7,
    usedAfter: 8,
    apiCallsMade: 1,
    ops: [
      { op: 'allFixtures', skipped: true, reason: 'indisponivel' },
      { op: 'daily', ok: true, count: 0, fixtures: [{ fixtureId: 1 }] },
    ],
  });

  assert.equal(response.status, 'ok');
  assert.equal(response.skipped, false);
  assert.equal(response.durationMs, 1000);
  assert.deepEqual(response.quota, {
    usedBefore: 7,
    usedAfter: 8,
    limit: 100,
    budget: 60,
    remaining: 92,
    remainingBudget: 52,
    apiCallsMade: 1,
  });
  assert.deepEqual(response.summary, { total: 2, ok: 1, skipped: 1, errors: 0 });
  assert.match(response.message, /Sync executado/);
  assert.equal(response.apiCallsMade, 1);
  assert.equal(response.used, 8);
  assert.equal(response.ops[1].fixtures, undefined);
});

test('buildCompactSyncResponse resume resposta do cron com provider ativo', () => {
  config.apiFootballSyncDailyBudget = 60;

  const response = buildSyncResponse({
    startedAt: '2030-06-11T16:00:00.000Z',
    finishedAt: '2030-06-11T16:00:02.000Z',
    status: 'ok',
    mode: 'normal',
    plan: 'free',
    usedBefore: 33,
    usedAfter: 33,
    apiCallsMade: 0,
    ops: [
      { op: 'standings', ok: true, provider: 'livescore', count: 48 },
      { op: 'live', skipped: true, reason: 'fora da janela de live' },
    ],
  });

  const compact = buildCompactSyncResponse(response, {
    provider: 'livescore',
    configured: true,
    quotaBucket: null,
  });

  assert.equal(compact.ok, true);
  assert.equal(compact.provider.live, 'livescore');
  assert.equal(compact.provider.quotaBucket, null);
  assert.equal(compact.warning, null);
  assert.deepEqual(compact.quota, {
    apiFootballCalls: 0,
    used: 33,
    budget: 60,
    remainingBudget: 27,
  });
  assert.deepEqual(compact.ran, [
    { op: 'standings', provider: 'livescore', count: 48, changes: null },
  ]);
  assert.deepEqual(compact.skipped, [
    { op: 'live', reason: 'fora da janela de live' },
  ]);
  assert.deepEqual(compact.errors, []);
});

test('buildCompactSyncResponse alerta quando provider ativo nao e livescore', () => {
  const response = buildSyncResponse({
    startedAt: '2030-06-11T16:00:00.000Z',
    finishedAt: '2030-06-11T16:00:02.000Z',
    status: 'error',
    mode: 'normal',
    plan: 'free',
    usedBefore: 33,
    usedAfter: 34,
    apiCallsMade: 1,
    ops: [
      { op: 'daily', error: 'API-Football error' },
    ],
  });

  const compact = buildCompactSyncResponse(response, {
    provider: 'api-football',
    configured: true,
    quotaBucket: 'api-football',
  });

  assert.equal(compact.ok, false);
  assert.equal(compact.provider.live, 'api-football');
  assert.match(compact.warning, /LIVE_SCORE_PROVIDER/);
  assert.deepEqual(compact.errors, [
    { op: 'daily', provider: null, error: 'API-Football error' },
  ]);
});
