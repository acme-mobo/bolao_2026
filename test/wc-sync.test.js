import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSyncLogEntry, getApiFootballCapabilities, shouldTrackApiFootballQuota } from '../src/wc-sync.js';

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
