import assert from 'node:assert/strict';
import test from 'node:test';
import { getApiFootballCapabilities } from '../src/wc-sync.js';

test('plano free nao sincroniza endpoints por season para Copa 2026', () => {
  const capabilities = getApiFootballCapabilities({ plan: 'free', season: 2026 });

  assert.equal(capabilities.canSyncSeasonFixtures, false);
  assert.equal(capabilities.canSyncStandings, false);
  assert.equal(capabilities.canSyncDailyFixtures, false);
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
