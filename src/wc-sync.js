/**
 * wc-sync.js — Orquestrador de sincronização API-Football → Firestore
 *
 * Responsabilidades:
 *  - Controle de uso diário (100 req/dia, 4 modos)
 *  - Lock distribuído para evitar concorrência
 *  - Escrita normalizada no Firestore (/worldcup/2026/...)
 *  - Bridge: atualiza também os matches do bolão para scoring de palpites
 *  - Decisão inteligente do que sincronizar a cada tick do cron
 */

import { FieldValue } from 'firebase-admin/firestore';
import { ApiFootballClient } from './api-football.js';
import { config } from './config.js';
import { getAdminFirestore } from './firebase-admin.js';
import { applyLiveFixturesToDb, createLiveScoreProvider } from './live-score.js';
import { store } from './store.js';
import { worldCup2026GroupMatches, worldCup2026Teams } from './world-cup-2026-data.js';

// ─── Constantes ───────────────────────────────────────
const DAILY_LIMIT   = 100;
const LOCK_TTL_MS   = 5 * 60 * 1000; // lock expira em 5 min
const LIVE_WINDOW_BEFORE_MS = 60 * 60_000;
const LIVE_WINDOW_AFTER_MS  = 3 * 60 * 60_000;

// Limiares de uso que mudam o modo de operação
const THRESHOLDS = { economy: 70, critical: 85, cacheOnly: 95 };

// Intervalos de staleness por operação (minutos), por modo
const INTERVALS = {
  //              normal  economy  critical
  allFixtures: [  360,    720,     null  ],  // null = skip
  standings:   [  240,    480,     null  ],
  daily:       [   60,    120,      180  ],
  live:        [   10,     15,       20  ],
};

const FREE_PLAN_SUPPORTED_SEASONS = new Set([2022, 2023, 2024]);

export function getApiFootballCapabilities(options = {}) {
  const plan = options.plan ?? config.apiFootballPlan;
  const season = options.season ?? config.apiFootballSeason;
  const isFreePlan = plan === 'free';
  const seasonSupported = !isFreePlan || FREE_PLAN_SUPPORTED_SEASONS.has(season);
  return {
    plan,
    canSyncSeasonFixtures: seasonSupported,
    canSyncStandings: seasonSupported,
    canSyncDailyFixtures: true,
    canSyncLive: true,
    seasonUnsupportedReason: isFreePlan
      ? 'API-Football Free não libera endpoints por season=2026; use /api/sync/seed para o calendário completo/local ou API_FOOTBALL_PLAN=paid.'
      : null,
  };
}

// ─── Firestore refs ───────────────────────────────────
const fs         = () => getAdminFirestore();
const wcRoot     = () => fs().collection('worldcup').doc('2026');
const systemCol  = () => fs().collection('system');

// ─── Controle de uso diário ───────────────────────────
export function getMode(used) {
  const budget = getApiFootballDailyBudget();
  if (used >= budget || used >= THRESHOLDS.cacheOnly) return 'cache-only';
  if (used >= THRESHOLDS.critical)  return 'critical';
  if (used >= THRESHOLDS.economy)   return 'economy';
  return 'normal';
}

export function getApiFootballDailyBudget(options = {}) {
  const budget = Number(options.budget ?? config.apiFootballSyncDailyBudget);
  if (!Number.isFinite(budget) || budget <= 0) return DAILY_LIMIT;
  return Math.min(Math.floor(budget), DAILY_LIMIT);
}

async function getUsage(date) {
  const ref = systemCol().doc(`usage_${date}`);
  await ref.set({ date, limit: DAILY_LIMIT }, { merge: true }); // inicializa sem sobrescrever used
  const snap = await ref.get();
  const data = snap.data();
  return { used: 0, ...data };
}

async function incrementUsage(date, calls) {
  await systemCol().doc(`usage_${date}`).set(
    { used: FieldValue.increment(calls), lastCallAt: new Date().toISOString() },
    { merge: true },
  );
}

// ─── Lock distribuído ─────────────────────────────────
async function acquireLock(name) {
  const ref = systemCol().doc(`lock_${name}`);
  return fs().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const age = Date.now() - new Date(snap.data().lockedAt).getTime();
      if (age < LOCK_TTL_MS) return false; // lock válido, skip
    }
    tx.set(ref, { lockedAt: new Date().toISOString() });
    return true;
  });
}

async function releaseLock(name) {
  await systemCol().doc(`lock_${name}`).delete().catch(() => {});
}

// ─── Helpers de staleness ─────────────────────────────
function minutesSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}

function intervalFor(op, mode) {
  const idx = { normal: 0, economy: 1, critical: 2 }[mode] ?? 0;
  return INTERVALS[op]?.[idx] ?? null;
}

export function shouldTrackApiFootballQuota(quotaSource) {
  return quotaSource.quotaBucket === undefined || quotaSource.quotaBucket === 'api-football';
}

export function hasApiFootballBudget(used, estimatedCalls = 1, options = {}) {
  return used + estimatedCalls <= getApiFootballDailyBudget(options);
}

function normalizeLocalFixture([fixtureId, group, homeCode, awayCode, date, venue, city]) {
  return { fixtureId, group, homeCode, awayCode, date, venue, city };
}

export function getLocalFixturesForDate(date, fixtures = worldCup2026GroupMatches.map(normalizeLocalFixture)) {
  return fixtures.filter((fixture) => fixture.date?.slice(0, 10) === date);
}

export function hasKnownTodayMatches(fixtures = []) {
  return fixtures.length > 0;
}

export function isInsideLiveWindow(fixtures = [], now = new Date()) {
  const nowMs = now.getTime();
  return fixtures.some((fixture) => {
    const startMs = new Date(fixture.date).getTime();
    if (!Number.isFinite(startMs)) return false;
    return nowMs >= startMs - LIVE_WINDOW_BEFORE_MS && nowMs <= startMs + LIVE_WINDOW_AFTER_MS;
  });
}

async function readKnownFixturesForDate(date) {
  const dailySnap = await wcRoot().collection('daily').doc(date).get();
  const dailyFixtures = dailySnap.exists ? dailySnap.data()?.fixtures ?? [] : [];
  const localFixtures = getLocalFixturesForDate(date);
  if (!dailyFixtures.length) return localFixtures;
  if (!localFixtures.length) return dailyFixtures;
  // Providers may encode fixture times in local US timezones instead of UTC, causing the stored
  // date to be off by several hours. Local data has authoritative UTC dates — always use them
  // for window detection, while still carrying live scores from Firestore.
  const dailyByPair = new Map(dailyFixtures.map((f) => [`${f.homeCode}-${f.awayCode}`, f]));
  const merged = localFixtures.map((local) => {
    const daily = dailyByPair.get(`${local.homeCode}-${local.awayCode}`);
    return daily ? { ...daily, date: local.date } : local;
  });
  const localPairs = new Set(localFixtures.map((f) => `${f.homeCode}-${f.awayCode}`));
  const extras = dailyFixtures.filter((f) => !localPairs.has(`${f.homeCode}-${f.awayCode}`));
  return [...merged, ...extras];
}

// ─── Escritas no Firestore ────────────────────────────
async function writeFixturesBatch(fixtures) {
  if (!fixtures.length) return;
  const root = wcRoot();
  // Firestore batch suporta até 500 ops; para 48 fixtures é suficiente
  const batch = fs().batch();
  for (const f of fixtures) {
    batch.set(root.collection('fixtures').doc(String(f.fixtureId)), f, { merge: true });
  }
  await batch.commit();
}

async function writeDailyDoc(date, fixtures) {
  await wcRoot().collection('daily').doc(date).set(
    { date, fixtures, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

async function writeLiveDoc(fixtures) {
  await wcRoot().collection('live').doc('current').set({
    fixtures,
    updatedAt: new Date().toISOString(),
  });
}

async function writeStandingsDoc(standings) {
  await wcRoot().collection('standings').doc('current').set({
    standings,
    updatedAt: new Date().toISOString(),
  });
}

async function writeSyncStatus(patch) {
  await wcRoot().collection('meta').doc('syncStatus').set(
    { ...patch, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

async function writeSyncLog(entry) {
  await wcRoot().collection('syncLogs').add(entry);
}

function summarizeSyncOp(op) {
  return {
    op:       op.op,
    ok:       op.ok ?? false,
    skipped:  op.skipped ?? false,
    count:    op.count ?? null,
    changes:  op.changes ?? null,
    matched:  op.matched ?? null,
    unmatchedExternalIds: op.unmatchedExternalIds ?? null,
    provider: op.provider ?? null,
    reason:   op.reason ?? null,
    error:    op.error ?? null,
  };
}

export function buildSyncLogEntry({
  startedAt,
  finishedAt,
  mode,
  plan,
  usedBefore,
  usedAfter,
  apiCallsMade,
  ops = [],
  status,
  trigger = 'sync',
}) {
  return {
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    mode,
    plan,
    usedBefore,
    usedAfter,
    apiCallsMade,
    ops: ops.map(summarizeSyncOp),
    status,
    trigger,
  };
}

function summarizeSyncResponseOps(ops) {
  return {
    total:   ops.length,
    ok:      ops.filter((op) => op.ok).length,
    skipped: ops.filter((op) => op.skipped).length,
    errors:  ops.filter((op) => op.error).length,
  };
}

function buildSyncMessage({ status, reason, ops, apiCallsMade, usedBefore, usedAfter, mode }) {
  if (status === 'skipped') {
    if (reason === 'cache-only') return `Sync ignorado: modo cache-only (${usedAfter}/${DAILY_LIMIT} chamadas usadas).`;
    return `Sync ignorado: ${reason}.`;
  }
  if (status === 'error') {
    return `Sync finalizado com erro em ${summarizeSyncResponseOps(ops).errors} operação(ões).`;
  }
  const okCount = summarizeSyncResponseOps(ops).ok;
  return `Sync executado em modo ${mode}: ${okCount} operação(ões) concluída(s), ${apiCallsMade} chamada(s) API-Football, uso ${usedBefore}->${usedAfter}.`;
}

export function buildSyncResponse({
  startedAt,
  finishedAt,
  status,
  reason = null,
  mode,
  plan,
  ops = [],
  apiCallsMade = 0,
  usedBefore,
  usedAfter,
}) {
  return {
    status,
    skipped: status === 'skipped',
    reason,
    message: buildSyncMessage({ status, reason, ops, apiCallsMade, usedBefore, usedAfter, mode }),
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    mode,
    plan,
    quota: {
      usedBefore,
      usedAfter,
      limit: DAILY_LIMIT,
      budget: getApiFootballDailyBudget(),
      remaining: Math.max(DAILY_LIMIT - usedAfter, 0),
      remainingBudget: Math.max(getApiFootballDailyBudget() - usedAfter, 0),
      apiCallsMade,
    },
    summary: summarizeSyncResponseOps(ops),
    ops: ops.map(summarizeSyncOp),
    apiCallsMade,
    used: usedAfter,
  };
}

export function buildCompactSyncResponse(response, providerStatus = {}) {
  const okOps = (response.ops ?? [])
    .filter((op) => op.ok)
    .map((op) => ({
      op: op.op,
      provider: op.provider,
      count: op.count,
      changes: op.changes,
    }));
  const errorOps = (response.ops ?? [])
    .filter((op) => op.error)
    .map((op) => ({
      op: op.op,
      provider: op.provider,
      error: op.error,
    }));
  const skippedOps = (response.ops ?? [])
    .filter((op) => op.skipped)
    .map((op) => ({
      op: op.op,
      reason: op.reason,
    }));

  const liveProvider = providerStatus.provider ?? null;
  return {
    ok: response.status !== 'error',
    status: response.status,
    message: response.message,
    provider: {
      live: liveProvider,
      configured: providerStatus.configured ?? null,
      quotaBucket: providerStatus.quotaBucket ?? null,
    },
    warning: liveProvider && liveProvider !== 'livescore'
      ? 'LIVE_SCORE_PROVIDER não está livescore neste ambiente; o sync ainda pode chamar API-Football.'
      : null,
    mode: response.mode,
    plan: response.plan,
    quota: {
      apiFootballCalls: response.quota?.apiCallsMade ?? 0,
      used: response.quota?.usedAfter ?? response.used,
      budget: response.quota?.budget ?? null,
      remainingBudget: response.quota?.remainingBudget ?? null,
    },
    summary: response.summary,
    ran: okOps,
    skipped: skippedOps,
    errors: errorOps,
    startedAt: response.startedAt,
    finishedAt: response.finishedAt,
    durationMs: response.durationMs,
  };
}

// ─── Bridge para o bolão (scoring de palpites) ────────
// Atualiza db.matches com placares da API-Football para que o scoring funcione
async function bridgeToBolaoDB(fixtures, providerName = 'api-football') {
  if (!fixtures.length) return [];
  const db = await store.load();
  const teamsById = new Map(db.teams.map((t) => [t.id, t]));
  const now = new Date().toISOString();
  const changes = [];

  for (const local of db.matches) {
    const home = teamsById.get(local.homeTeamId);
    const away = teamsById.get(local.awayTeamId);

    const remote = fixtures.find(
      (f) => (local.externalMatchId && String(local.externalMatchId) === String(f.externalId ?? f.fixtureId))
        || (home?.code === f.homeCode && away?.code === f.awayCode),
    );
    if (!remote) continue;

    const before = { status: local.status, homeGoals: local.homeGoals, awayGoals: local.awayGoals };

    local.externalProvider  = providerName;
    local.externalMatchId   = String(remote.externalId ?? remote.fixtureId);
    local.externalLastUpdated = now;
    local.status = remote.status;

    if (remote.homeGoals !== null && remote.awayGoals !== null) {
      local.homeGoals = remote.homeGoals;
      local.awayGoals = remote.awayGoals;
    }

    const changed =
      before.status    !== local.status    ||
      before.homeGoals !== local.homeGoals ||
      before.awayGoals !== local.awayGoals;

    if (changed) {
      changes.push({
        matchId: local.id,
        before,
        after: { status: local.status, homeGoals: local.homeGoals, awayGoals: local.awayGoals },
      });
    }
  }

  if (changes.length > 0) await store.save();
  return changes;
}

async function bridgeStandingsToBolaoDB(standings, providerName = 'api-football') {
  const db = await store.load();
  const now = new Date().toISOString();
  db.standings = standings.map((standing) => ({
    id: `${standing.group}_${standing.teamId ?? standing.teamCode ?? standing.rank}`,
    ...standing,
    externalProvider: providerName,
    externalLastUpdated: now,
  }));
  await store.save();
  return db.standings;
}

// ─── Operações de sync individuais ────────────────────
async function runWithLock(lockName, fn) {
  const locked = await acquireLock(lockName);
  if (!locked) return { skipped: true, reason: 'lock ativo' };
  try {
    return await fn();
  } finally {
    await releaseLock(lockName);
  }
}

async function doSyncAllFixtures(client) {
  return runWithLock('allFixtures', async () => {
    const fixtures = await client.fetchAllFixtures();
    await writeFixturesBatch(fixtures);
    await bridgeToBolaoDB(fixtures);
    await writeSyncStatus({ lastAllFixtures: new Date().toISOString() });
    return { ok: true, count: fixtures.length };
  });
}

async function doSyncDaily(client, date) {
  return runWithLock('daily', async () => {
    const fixtures = await client.fetchDailyFixtures(date);
    await writeDailyDoc(date, fixtures);
    await writeFixturesBatch(fixtures);
    const changes = await bridgeToBolaoDB(fixtures);
    const now = new Date().toISOString();
    await writeSyncStatus({
      lastDailyFixtures: now,
      ...(changes.length > 0 ? { lastScoreChange: now, scoreChanges: changes.length } : {}),
    });
    return { ok: true, count: fixtures.length, changes: changes.length };
  });
}

async function doSyncDailyFromProvider(provider, date) {
  return runWithLock('daily', async () => {
    const providerStatus = provider.getStatus();
    const fixtures = (await provider.fetchLiveFixtures())
      .filter((fixture) => fixture.date?.slice(0, 10) === date);
    await writeDailyDoc(date, fixtures);
    await writeFixturesBatch(fixtures);
    const changes = await bridgeToBolaoDB(fixtures, providerStatus.provider);
    const now = new Date().toISOString();
    await writeSyncStatus({
      lastDailyFixtures: now,
      ...(changes.length > 0 ? { lastScoreChange: now, scoreChanges: changes.length } : {}),
    });
    return { ok: true, count: fixtures.length, changes: changes.length, provider: providerStatus.provider };
  });
}

async function doSyncLive(provider) {
  return runWithLock('live', async () => {
    const fixtures = await provider.fetchLiveFixtures();
    const providerStatus = provider.getStatus();
    await writeLiveDoc(fixtures);
    await writeFixturesBatch(fixtures);
    const db = await store.load();
    const result = applyLiveFixturesToDb(db, fixtures, providerStatus);
    if (result.updated > 0) await store.save();
    const now = new Date().toISOString();
    await writeSyncStatus({
      lastLive: now,
      liveCount: fixtures.length,
      ...(result.updated > 0 ? { lastScoreChange: now, scoreChanges: result.updated } : {}),
    });
    return {
      ok: true,
      count: fixtures.length,
      changes: result.updated,
      matched: result.matched,
      unmatchedExternalIds: result.unmatchedExternalIds,
      provider: providerStatus.provider,
    };
  });
}

async function doSyncStandings(client) {
  return runWithLock('standings', async () => {
    const standings = await client.fetchStandings();
    const providerName = client.getStatus?.().provider ?? 'api-football';
    await writeStandingsDoc(standings);
    await bridgeStandingsToBolaoDB(standings, providerName);
    await writeSyncStatus({ lastStandings: new Date().toISOString() });
    return { ok: true, count: standings.length, provider: providerName };
  });
}

export function getDailySyncSource(client, liveProvider) {
  if (!shouldTrackApiFootballQuota(liveProvider)) {
    return {
      type: 'live-provider',
      source: liveProvider,
      configured: liveProvider.configured,
      provider: liveProvider.getStatus().provider,
      tracksApiFootball: false,
    };
  }

  return {
    type: 'api-football',
    source: client,
    configured: client.configured,
    provider: 'api-football',
    tracksApiFootball: true,
  };
}

export function getStandingsSyncSource(client, liveProvider) {
  if (!shouldTrackApiFootballQuota(liveProvider) && typeof liveProvider.fetchStandings === 'function') {
    return {
      source: liveProvider,
      configured: liveProvider.configured,
      provider: liveProvider.getStatus().provider,
      tracksApiFootball: false,
    };
  }

  return {
    source: client,
    configured: client.configured,
    provider: 'api-football',
    tracksApiFootball: true,
  };
}

export function shouldRunLiveSync({ force = false, liveInterval, lastLive, hasMatchesToday, hasLiveNow, insideLiveWindow }) {
  return liveInterval !== null
    && (force || minutesSince(lastLive) > liveInterval)
    && hasMatchesToday
    && (hasLiveNow || insideLiveWindow);
}

// ─── Orquestrador principal ───────────────────────────
export async function orchestrate(options = {}) {
  const force = options.force === true;
  const startedAt = new Date().toISOString();
  const globalLocked = await acquireLock('sync');
  if (!globalLocked) {
    const todayUtc = new Date().toISOString().slice(0, 10);
    const usage = await getUsage(todayUtc);
    const mode = getMode(usage.used);
    const finishedAt = new Date().toISOString();
    const capabilities = getApiFootballCapabilities();
    return buildSyncResponse({
      startedAt,
      finishedAt,
      status: 'skipped',
      reason: 'lock ativo',
      mode,
      plan: capabilities.plan,
      usedBefore: usage.used,
      usedAfter: usage.used,
    });
  }

  try {
  const client = new ApiFootballClient();
  const liveProvider = createLiveScoreProvider();

  const capabilities = getApiFootballCapabilities();

  const todayUtc = new Date().toISOString().slice(0, 10);
  const usage    = await getUsage(todayUtc);
  const mode     = getMode(usage.used);
  const writeRunLog = async ({ status, ops = [], usedAfter = usage.used, apiCallsMade = 0, mode: logMode = mode, finishedAt = new Date().toISOString() }) => {
    await writeSyncLog(buildSyncLogEntry({
      startedAt,
      finishedAt,
      mode: logMode,
      plan: capabilities.plan,
      usedBefore: usage.used,
      usedAfter,
      apiCallsMade,
      ops,
      status,
      trigger: 'sync',
    }));
  };

  if (mode === 'cache-only') {
    await writeSyncStatus({ mode, message: 'Cache-only: orçamento diário atingido' });
    const finishedAt = new Date().toISOString();
    await writeRunLog({ status: 'skipped', finishedAt });
    return buildSyncResponse({
      startedAt,
      finishedAt,
      status: 'skipped',
      reason: 'cache-only',
      mode,
      plan: capabilities.plan,
      usedBefore: usage.used,
      usedAfter: usage.used,
    });
  }

  // Lê status atual de sincronização
  const statusSnap = await wcRoot().collection('meta').doc('syncStatus').get();
  const status     = statusSnap.exists ? statusSnap.data() : {};

  // Verifica se há jogos ativos ou em janela próxima (para decidir sobre live)
  const liveSnap  = await wcRoot().collection('live').doc('current').get();
  const liveData  = liveSnap.exists ? liveSnap.data() : { fixtures: [] };
  const hasLiveNow = (liveData.fixtures ?? []).some((f) => f.status === 'live');
  const knownTodayFixtures = await readKnownFixturesForDate(todayUtc);
  const hasMatchesToday = hasKnownTodayMatches(knownTodayFixtures);
  const insideLiveWindow = isInsideLiveWindow(knownTodayFixtures);
  let estimatedApiFootballCalls = 0;

  const canSpendApiFootballCall = (estimatedCalls = 1) => {
    return hasApiFootballBudget(usage.used, estimatedApiFootballCalls + estimatedCalls);
  };

  const reserveApiFootballCall = (estimatedCalls = 1) => {
    estimatedApiFootballCalls += estimatedCalls;
  };

  // ── Decide o que sincronizar ───────────────────────
  const pending = [];
  const skipped = [];

  const allInterval = intervalFor('allFixtures', mode);
  if (allInterval !== null && minutesSince(status.lastAllFixtures) > allInterval) {
    if (!client.configured) {
      skipped.push({ op: 'allFixtures', skipped: true, reason: 'API_FOOTBALL_KEY não configurado' });
    } else if (capabilities.canSyncSeasonFixtures) {
      if (canSpendApiFootballCall()) {
        pending.push({ name: 'allFixtures', fn: () => doSyncAllFixtures(client) });
        reserveApiFootballCall();
      } else {
        skipped.push({ op: 'allFixtures', skipped: true, reason: 'orçamento diário API-Football atingido' });
      }
    } else {
      skipped.push({ op: 'allFixtures', skipped: true, reason: capabilities.seasonUnsupportedReason });
    }
  }

  const standingsInterval = intervalFor('standings', mode);
  if (standingsInterval !== null && minutesSince(status.lastStandings) > standingsInterval) {
    const standingsSource = getStandingsSyncSource(client, liveProvider);
    if (!standingsSource.configured) {
      skipped.push({ op: 'standings', skipped: true, reason: `${standingsSource.provider} não configurado` });
    } else if (!standingsSource.tracksApiFootball || capabilities.canSyncStandings) {
      if (!standingsSource.tracksApiFootball || canSpendApiFootballCall()) {
        pending.push({ name: 'standings', fn: () => doSyncStandings(standingsSource.source), quotaSource: standingsSource.source });
        if (standingsSource.tracksApiFootball) reserveApiFootballCall();
      } else {
        skipped.push({ op: 'standings', skipped: true, reason: 'orçamento diário API-Football atingido' });
      }
    } else {
      skipped.push({ op: 'standings', skipped: true, reason: capabilities.seasonUnsupportedReason });
    }
  }

  const dailyInterval = intervalFor('daily', mode);
  if (dailyInterval !== null && minutesSince(status.lastDailyFixtures) > dailyInterval) {
    const dailySource = getDailySyncSource(client, liveProvider);
    if (!hasMatchesToday) {
      skipped.push({ op: 'daily', skipped: true, reason: 'sem jogos conhecidos hoje' });
    } else if (!dailySource.configured) {
      skipped.push({ op: 'daily', skipped: true, reason: `${dailySource.provider} não configurado` });
    } else if (capabilities.canSyncDailyFixtures) {
      if (!dailySource.tracksApiFootball || canSpendApiFootballCall()) {
        const fn = dailySource.type === 'live-provider'
          ? () => doSyncDailyFromProvider(dailySource.source, todayUtc)
          : () => doSyncDaily(dailySource.source, todayUtc);
        pending.push({ name: 'daily', fn, quotaSource: dailySource.source });
        if (dailySource.tracksApiFootball) reserveApiFootballCall();
      } else {
        skipped.push({ op: 'daily', skipped: true, reason: 'orçamento diário API-Football atingido' });
      }
    } else {
      skipped.push({ op: 'daily', skipped: true, reason: capabilities.seasonUnsupportedReason });
    }
  }

  const liveInterval = intervalFor('live', mode);
  const shouldSyncLive = shouldRunLiveSync({
    force,
    liveInterval,
    lastLive: status.lastLive,
    hasMatchesToday,
    hasLiveNow,
    insideLiveWindow,
  });
  if (shouldSyncLive) {
    if (liveProvider.configured) {
      const tracksApiFootball = shouldTrackApiFootballQuota(liveProvider);
      if (!tracksApiFootball || canSpendApiFootballCall()) {
        pending.push({ name: 'live', fn: () => doSyncLive(liveProvider), quotaSource: liveProvider });
        if (tracksApiFootball) reserveApiFootballCall();
      } else {
        skipped.push({ op: 'live', skipped: true, reason: 'orçamento diário API-Football atingido' });
      }
    } else {
      skipped.push({ op: 'live', skipped: true, reason: `${liveProvider.getStatus().provider} não configurado` });
    }
  } else if (liveInterval !== null && (force || minutesSince(status.lastLive) > liveInterval)) {
    skipped.push({
      op: 'live',
      skipped: true,
      reason: hasMatchesToday ? 'fora da janela de live' : 'sem jogos conhecidos hoje',
    });
  }

  if (!pending.length) {
    const reason = skipped.length ? 'operações remotas indisponíveis no plano atual' : 'nada a sincronizar';
    const finishedAt = new Date().toISOString();
    await writeRunLog({ status: 'skipped', ops: skipped, finishedAt });
    return {
      ...buildSyncResponse({
        startedAt,
        finishedAt,
        status: 'skipped',
        reason,
        mode,
        plan: capabilities.plan,
        ops: skipped,
        usedBefore: usage.used,
        usedAfter: usage.used,
      }),
      mode,
      plan: capabilities.plan,
      skipped: true,
      used: usage.used,
    };
  }

  // ── Executa operações e rastreia uso ───────────────
  const results = [];
  let apiCallsMade = 0;

  for (const { name, fn, quotaSource = client } of pending) {
    const trackApiFootballQuota = shouldTrackApiFootballQuota(quotaSource);
    const beforeRequestCount = trackApiFootballQuota ? quotaSource.requestCount : 0;
    try {
      const result = await fn();
      results.push({ op: name, ...result });
    } catch (err) {
      results.push({ op: name, error: err.message });
    } finally {
      if (trackApiFootballQuota) {
        apiCallsMade += quotaSource.requestCount - beforeRequestCount;
      }
    }
  }

  if (apiCallsMade > 0) await incrementUsage(todayUtc, apiCallsMade);

  const updatedUsed = usage.used + apiCallsMade;
  const updatedMode = getMode(updatedUsed);
  const hhmm = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

  await writeSyncStatus({
    mode:       updatedMode,
    usedToday:  updatedUsed,
    dailyLimit: DAILY_LIMIT,
    message:    `Atualizado às ${hhmm}`,
  });

  const ops = [...skipped, ...results];
  const logStatus = results.some((result) => result.error) ? 'error' : 'ok';
  const finishedAt = new Date().toISOString();
  await writeRunLog({
    status: logStatus,
    ops,
    usedAfter: updatedUsed,
    apiCallsMade,
    mode: updatedMode,
    finishedAt,
  });

  return buildSyncResponse({
    startedAt,
    finishedAt,
    status: logStatus,
    mode: updatedMode,
    plan: capabilities.plan,
    ops,
    apiCallsMade,
    usedBefore: usage.used,
    usedAfter: updatedUsed,
  });
  } finally {
    await releaseLock('sync');
  }
}

// ─── Seed local (dados de world-cup-2026-data.js) ────
export async function seedLocalFixtures() {
  const teamNames = Object.fromEntries(worldCup2026Teams.map(([name, code]) => [code, name]));
  const now = new Date().toISOString();

  const fixtures = worldCup2026GroupMatches.map(([num, group, homeCode, awayCode, date, venue, city]) => ({
    fixtureId:     num,
    date,
    statusShort:   'NS',
    statusElapsed: null,
    status:        'scheduled',
    round:         'Group Stage',
    group,
    venue,
    city,
    homeCode,
    awayCode,
    homeName:      teamNames[homeCode] ?? homeCode,
    awayName:      teamNames[awayCode] ?? awayCode,
    homeLogo:      null,
    awayLogo:      null,
    homeGoals:     null,
    awayGoals:     null,
    updatedAt:     now,
    source:        'local',
  }));

  // Agrupa por data UTC para popular os docs de daily
  const byDate = {};
  for (const f of fixtures) {
    const dateKey = f.date.slice(0, 10);
    (byDate[dateKey] ??= []).push(f);
  }

  // Escreve fixtures individuais em batch
  await writeFixturesBatch(fixtures);

  // Escreve um doc por data
  const root = wcRoot();
  const fsBatch = fs().batch();
  for (const [date, dayFixtures] of Object.entries(byDate)) {
    fsBatch.set(
      root.collection('daily').doc(date),
      { date, fixtures: dayFixtures, updatedAt: now },
    );
  }
  await fsBatch.commit();

  // Marca allFixtures como recém-sincronizado para o cron não tentar re-buscar
  await writeSyncStatus({
    lastAllFixtures:   now,
    lastDailyFixtures: now,
    source:            'local-seed',
    message:           `Seed local: ${fixtures.length} jogos escritos em ${Object.keys(byDate).length} datas`,
  });

  return { seeded: fixtures.length, dates: Object.keys(byDate).length };
}

// ─── Leitura de status (para o frontend/admin) ────────
export async function getSyncStatus() {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const [statusSnap, usage] = await Promise.all([
    wcRoot().collection('meta').doc('syncStatus').get(),
    getUsage(todayUtc),
  ]);

  const status = statusSnap.exists ? statusSnap.data() : {};
  return {
    ...status,
    usedToday:  usage.used,
    dailyLimit: DAILY_LIMIT,
    mode:       getMode(usage.used),
  };
}
