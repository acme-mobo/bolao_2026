import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  buildSyncLogEntry,
  buildSyncResponse,
  getApiFootballDailyBudget,
  getApiFootballCapabilities,
  getLocalFixturesForDate,
  shouldTrackApiFootballQuota,
  hasApiFootballBudget,
  hasKnownTodayMatches,
  isInsideLiveWindow,
} from '../src/wc-sync.js';
import { config } from '../src/config.js';

const originalBudget = config.apiFootballSyncDailyBudget;

afterEach(() => {
  config.apiFootballSyncDailyBudget = originalBudget;
});

test('plano free bloqueia endpoints por season mas permite fixtures por data', () => {
  const capabilities = getApiFootballCapabilities({ plan: 'free', season: 2026 });

  assert.equal(capabilities.canSyncSeasonFixtures, false);
  assert.equal(capabilities.canSyncStandings, false);
  assert.equal(capabilities.canSyncDailyFixtures, true);
  assert.equal(capabilities.canSyncLive, true);
  assert.match(capabilities.seasonUnsupportedReason, /Free.*season=2026/);
});

test('plano paid libera sync completo da Copa 2026', () => {
  const capabilities = getApiFootballCapabilities({ plan: 'paid', season: 2026 });

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
  const june10 = getLocalFixturesForDate('2026-06-10');
  const june11 = getLocalFixturesForDate('2026-06-11');

  assert.equal(hasKnownTodayMatches(june10), false);
  assert.equal(hasKnownTodayMatches(june11), true);
  assert.equal(june11[0].fixtureId, 1);
});

test('janela de live considera uma hora antes ate tres horas depois', () => {
  const fixtures = [{ date: '2026-06-11T19:00:00.000Z' }];

  assert.equal(isInsideLiveWindow(fixtures, new Date('2026-06-11T17:59:59.000Z')), false);
  assert.equal(isInsideLiveWindow(fixtures, new Date('2026-06-11T18:00:00.000Z')), true);
  assert.equal(isInsideLiveWindow(fixtures, new Date('2026-06-11T22:00:00.000Z')), true);
  assert.equal(isInsideLiveWindow(fixtures, new Date('2026-06-11T22:00:01.000Z')), false);
});

test('janela de live ignora dias sem jogo conhecido', () => {
  assert.equal(isInsideLiveWindow([], new Date('2026-06-11T19:00:00.000Z')), false);
});

test('buildSyncLogEntry monta log resumido sem payload bruto', () => {
  const entry = buildSyncLogEntry({
    startedAt: '2026-06-09T18:00:00.000Z',
    finishedAt: '2026-06-09T18:00:02.500Z',
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
    startedAt: '2026-06-09T18:00:00.000Z',
    finishedAt: '2026-06-09T18:00:02.500Z',
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
    startedAt: '2026-06-09T18:00:00.000Z',
    finishedAt: '2026-06-09T18:00:01.000Z',
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
