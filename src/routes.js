import { createToken, deleteFirebaseAuthUser, hashPassword, requireAdmin, requireFirebaseAuth, verifyPassword } from './auth.js';
import { assert } from './errors.js';
import { newId } from './id.js';
import { notFound, parseUrl, readJson, sanitizeUser, send } from './http.js';
import { createLiveScoreProvider, syncLiveScores } from './live-score.js';
import {
  findMatchByReference,
  hasMatchTeamsDefined,
  isPredictionOpen,
  predictionBelongsToMatch,
} from './match-reference.js';
import { buildLeaderboard, scorePrediction } from './scoring.js';
import { optionalDate, requireEmail, requireInteger, requireString } from './validation.js';
import { buildCompactSyncResponse, orchestrate } from './wc-sync.js';

const publicApiCacheControl = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
const liveApiCacheControl = 'public, max-age=0, s-maxage=10, stale-while-revalidate=15';

function route(method, pattern, handler, options = {}) {
  return { method, pattern, handler, ...options };
}

function publicPool(pool) {
  return {
    id: pool.id,
    name: pool.name,
    ownerId: pool.ownerId,
    inviteCode: pool.inviteCode,
    createdAt: pool.createdAt,
  };
}

function ensureActivePool(db, user) {
  const now = new Date().toISOString();
  let pool = db.pools.find((candidate) => candidate.isActive) ?? db.pools[0];

  if (!pool) {
    pool = {
      id: 'pool_copa_2026',
      name: 'Bolao Copa 2026',
      ownerId: user.id,
      inviteCode: 'COPA2026',
      isActive: true,
      createdAt: now,
    };
    db.pools.push(pool);
  } else if (!pool.isActive) {
    pool.isActive = true;
  }

  const existingMembership = db.memberships.find(
    (membership) => membership.poolId === pool.id && membership.userId === user.id,
  );
  if (!existingMembership) {
    db.memberships.push({ poolId: pool.id, userId: user.id, joinedAt: now });
  }

  return pool;
}

function buildGroups(db) {
  const standingsByGroup = new Map();
  for (const standing of db.standings ?? []) {
    if (!standing.group) continue;
    const groupStandings = standingsByGroup.get(standing.group) ?? [];
    groupStandings.push(standing);
    standingsByGroup.set(standing.group, groupStandings);
  }

  return [...new Set(db.teams.map((team) => team.group).filter(Boolean))]
    .sort()
    .map((group) => ({
      group,
      teams: db.teams.filter((team) => team.group === group),
      table: (standingsByGroup.get(group) ?? [])
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
      matches: db.matches
        .filter((match) => match.group === group)
        .sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0)),
    }));
}

const summaryDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function matchLocalDate(startsAt) {
  return startsAt ? summaryDateFormatter.format(new Date(startsAt)) : null;
}

function isLiveSensitiveMatch(match, nowMs = Date.now()) {
  if (match.status === 'live') return true;
  if (match.status === 'finished' || match.status === 'cancelled') return false;
  const startsAtMs = new Date(match.startsAt).getTime();
  if (!Number.isFinite(startsAtMs)) return false;
  return nowMs >= startsAtMs - 60 * 60_000 && nowMs <= startsAtMs + 3 * 60 * 60_000;
}

function publicMatchesCacheControl(request, matches) {
  const searchParams = parseUrl(request).searchParams;
  if (searchParams.has('fresh')) return 'no-store, max-age=0';
  return matches.some((match) => isLiveSensitiveMatch(match))
    ? liveApiCacheControl
    : publicApiCacheControl;
}

export function createRouter(store, options = {}) {
  const liveScoreProvider = options.liveScoreProvider ?? createLiveScoreProvider();
  const routes = [
    route('GET', /^\/health$/, (_request, response) => {
      send(response, 200, { status: 'ok' });
    }),

    route('POST', /^\/auth\/register$/, async (request, response, db) => {
      const body = await readJson(request);
      const name = requireString(body.name, 'name', 2);
      const email = requireEmail(body.email);
      const password = requireString(body.password, 'password', 8);

      const result = await store.transaction((currentDb) => {
        assert(!currentDb.users.some((user) => user.email === email), 409, 'Email ja cadastrado');
        const user = {
          id: newId('usr'),
          name,
          email,
          passwordHash: hashPassword(password),
          role: currentDb.users.length === 0 ? 'admin' : 'player',
          createdAt: new Date().toISOString(),
        };
        currentDb.users.push(user);
        return { user: sanitizeUser(user), token: createToken(user) };
      });

      send(response, 201, result);
    }, { collections: ['users'] }),

    route('POST', /^\/auth\/login$/, async (request, response, db) => {
      const body = await readJson(request);
      const email = requireEmail(body.email);
      const password = requireString(body.password, 'password');
      const user = db.users.find((candidate) => candidate.email === email);
      assert(user && verifyPassword(password, user.passwordHash), 401, 'Credenciais invalidas');
      send(response, 200, { user: sanitizeUser(user), token: createToken(user) });
    }, { collections: ['users'] }),

    route('GET', /^\/me$/, async (request, response, db) => {
      const user = await requireFirebaseAuth(db, request);
      send(response, 200, { user: sanitizeUser(user) });
    }, { collections: ['users'] }),

    route('PATCH', /^\/me$/, async (request, response, db) => {
      const user = await requireFirebaseAuth(db, request);
      const body = await readJson(request);

      const updated = await store.transaction((currentDb) => {
        const existing = currentDb.users.find((u) => u.id === user.id);
        assert(existing, 404, 'Usuario nao encontrado');
        if (body.name !== undefined) {
          existing.name = requireString(body.name, 'name', 2);
        }
        return existing;
      });

      send(response, 200, { user: sanitizeUser(updated) });
    }, { collections: ['users'] }),

    route('DELETE', /^\/me$/, async (request, response, db) => {
      const user = await requireFirebaseAuth(db, request);

      await store.transaction((currentDb) => {
        currentDb.predictions = currentDb.predictions.filter((p) => p.userId !== user.id);
        currentDb.memberships = currentDb.memberships.filter((m) => m.userId !== user.id);
        currentDb.users       = currentDb.users.filter((u) => u.id !== user.id);
        return null;
      });

      await deleteFirebaseAuthUser(user.id);

      send(response, 200, { ok: true });
    }, { collections: ['users', 'memberships', 'predictions'] }),

    route('GET', /^\/groups$/, (_request, response, db) => {
      send(response, 200, { groups: buildGroups(db) });
    }, { collections: ['teams', 'matches', 'standings'] }),

    route('GET', /^\/groups\/([A-L])$/, (_request, response, db, [, group]) => {
      const found = buildGroups(db).find((candidate) => candidate.group === group);
      assert(found, 404, 'Grupo nao encontrado');
      send(response, 200, { group: found });
    }, { collections: ['teams', 'matches', 'standings'] }),

    route('GET', /^\/teams$/, (_request, response, db) => {
      send(response, 200, { teams: db.teams });
    }, { collections: ['teams'] }),

    route('POST', /^\/teams$/, async (request, response, db) => {
      const user = await requireFirebaseAuth(db, request);
      requireAdmin(user);
      const body = await readJson(request);
      const name = requireString(body.name, 'name', 2);
      const code = requireString(body.code, 'code', 2).toUpperCase();
      const group = body.group ? requireString(body.group, 'group').toUpperCase() : null;

      const team = await store.transaction((currentDb) => {
        assert(!currentDb.teams.some((candidate) => candidate.code === code), 409, 'Time ja existe');
        const created = { id: newId('team'), name, code, group };
        currentDb.teams.push(created);
        return created;
      });

      send(response, 201, { team });
    }, { collections: ['users', 'teams'] }),

    route('GET', /^\/matches$/, (request, response, db) => {
      const status = parseUrl(request).searchParams.get('status');
      const matches = status ? db.matches.filter((match) => match.status === status) : db.matches;
      send(response, 200, { matches }, { cacheControl: publicMatchesCacheControl(request, matches) });
    }, { collections: ['matches'] }),

    route('GET', /^\/matches\/summary$/, (request, response, db) => {
      const dateParam = parseUrl(request).searchParams.get('date');
      let matches = db.matches;
      if (dateParam) {
        const day = dateParam.slice(0, 10);
        matches = matches.filter((m) => matchLocalDate(m.startsAt) === day);
      }
      const summarizedMatches = matches
        .sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0))
        .map((m) => {
          const home = db.teams.find((t) => t.id === m.homeTeamId);
          const away = db.teams.find((t) => t.id === m.awayTeamId);
          return {
            matchNumber: m.matchNumber ?? null,
            status: m.status,
            homeTeam: home?.name ?? null,
            awayTeam: away?.name ?? null,
            homeCode: home?.code ?? null,
            awayCode: away?.code ?? null,
            homeGoals: m.homeGoals,
            awayGoals: m.awayGoals,
          };
        });

      send(response, 200, { matches: summarizedMatches }, { cacheControl: publicMatchesCacheControl(request, matches) });
    }, { collections: ['matches', 'teams'] }),

    route('GET', /^\/live-score\/provider$/, (_request, response) => {
      send(response, 200, liveScoreProvider.getStatus());
    }),

    route('POST', /^\/live-score\/sync$/, async (request, response, db) => {
      const user = await requireFirebaseAuth(db, request);
      requireAdmin(user);

      const result = await syncLiveScores(db, liveScoreProvider);
      await store.save();

      send(response, 200, result);
    }, { collections: ['users', 'teams', 'matches'] }),

    route('POST', /^\/admin\/sync$/, async (request, response, db) => {
      const user = await requireFirebaseAuth(db, request);
      requireAdmin(user);
      assert(store.kind === 'firestore', 500, 'Sync admin deve rodar com DATA_STORE=firestore para persistir no Firebase');

      const providerStatus = liveScoreProvider.getStatus();
      const result = await orchestrate({ force: true });

      send(response, 200, { sync: buildCompactSyncResponse(result, providerStatus) });
    }, { collections: ['users'] }),

    route('POST', /^\/matches$/, async (request, response, db) => {
      const user = await requireFirebaseAuth(db, request);
      requireAdmin(user);
      const body = await readJson(request);
      const homeTeamId = requireString(body.homeTeamId, 'homeTeamId');
      const awayTeamId = requireString(body.awayTeamId, 'awayTeamId');
      assert(homeTeamId !== awayTeamId, 400, 'Times do jogo devem ser diferentes');
      assert(db.teams.some((team) => team.id === homeTeamId), 400, 'Mandante nao encontrado');
      assert(db.teams.some((team) => team.id === awayTeamId), 400, 'Visitante nao encontrado');
      const startsAt = optionalDate(body.startsAt, 'startsAt') ?? new Date().toISOString();

      const match = await store.transaction((currentDb) => {
        const created = {
          id: newId('match'),
          homeTeamId,
          awayTeamId,
          stage: body.stage ? requireString(body.stage, 'stage') : 'group',
          group: body.group ? requireString(body.group, 'group').toUpperCase() : null,
          startsAt,
          lockAt: optionalDate(body.lockAt, 'lockAt') ?? startsAt,
          status: 'scheduled',
          homeGoals: null,
          awayGoals: null,
          createdAt: new Date().toISOString(),
        };
        currentDb.matches.push(created);
        return created;
      });

      send(response, 201, { match });
    }, { collections: ['users', 'teams', 'matches'] }),

    route('PATCH', /^\/matches\/([^/]+)$/, async (request, response, db, [, matchId]) => {
      const user = await requireFirebaseAuth(db, request);
      requireAdmin(user);
      const body = await readJson(request);

      const match = await store.transaction((currentDb) => {
        const existing = currentDb.matches.find((candidate) => candidate.id === matchId);
        assert(existing, 404, 'Jogo nao encontrado');

        if (body.startsAt !== undefined) existing.startsAt = optionalDate(body.startsAt, 'startsAt');
        if (body.lockAt !== undefined) existing.lockAt = optionalDate(body.lockAt, 'lockAt');
        const statusProvided = body.status !== undefined;
        if (body.status !== undefined) {
          assert(['scheduled', 'live', 'finished', 'cancelled'].includes(body.status), 400, 'Status invalido');
          existing.status = body.status;
        }
        if (body.homeGoals !== undefined) {
          existing.homeGoals = body.homeGoals === null ? null : requireInteger(body.homeGoals, 'homeGoals', 0);
        }
        if (body.awayGoals !== undefined) {
          existing.awayGoals = body.awayGoals === null ? null : requireInteger(body.awayGoals, 'awayGoals', 0);
        }
        if (!statusProvided && existing.homeGoals !== null && existing.awayGoals !== null) existing.status = 'finished';

        return existing;
      });

      send(response, 200, { match });
    }, { collections: ['users', 'matches'] }),

    route('POST', /^\/pools$/, async (request, response, db) => {
      const user = await requireFirebaseAuth(db, request);
      const body = await readJson(request);
      const name = requireString(body.name, 'name', 3);

      const pool = await store.transaction((currentDb) => {
        const created = {
          id: newId('pool'),
          name,
          ownerId: user.id,
          inviteCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
          createdAt: new Date().toISOString(),
        };
        currentDb.pools.push(created);
        currentDb.memberships.push({ poolId: created.id, userId: user.id, joinedAt: created.createdAt });
        return created;
      });

      send(response, 201, { pool: publicPool(pool) });
    }, { collections: ['users', 'pools', 'memberships'] }),

    route('GET', /^\/pools\/active$/, async (request, response, db) => {
      const user = await requireFirebaseAuth(db, request);
      const pool = await store.transaction((currentDb) => ensureActivePool(currentDb, user));
      send(response, 200, { pool: publicPool(pool) });
    }, { collections: ['users', 'pools', 'memberships'] }),

    route('GET', /^\/pools$/, async (request, response, db) => {
      const user = await requireFirebaseAuth(db, request);
      const pool = await store.transaction((currentDb) => ensureActivePool(currentDb, user));
      send(response, 200, { pools: [publicPool(pool)] });
    }, { collections: ['users', 'pools', 'memberships'] }),

    route('GET', /^\/pools\/([^/]+)$/, async (request, response, db, [, poolId]) => {
      const user = await requireFirebaseAuth(db, request);
      const pool = db.pools.find((candidate) => candidate.id === poolId);
      assert(pool, 404, 'Bolao nao encontrado');
      assert(
        db.memberships.some((membership) => membership.poolId === poolId && membership.userId === user.id),
        403,
        'Voce nao participa deste bolao',
      );
      send(response, 200, { pool: publicPool(pool) });
    }, { collections: ['users', 'pools', 'memberships'] }),

    route('POST', /^\/pools\/([^/]+)\/join$/, async (request, response, db, [, poolId]) => {
      const user = await requireFirebaseAuth(db, request);
      const body = await readJson(request);
      const inviteCode = body.inviteCode ? requireString(body.inviteCode, 'inviteCode').toUpperCase() : undefined;

      const membership = await store.transaction((currentDb) => {
        const pool = currentDb.pools.find((candidate) => candidate.id === poolId);
        assert(pool, 404, 'Bolao nao encontrado');
        assert(!inviteCode || pool.inviteCode === inviteCode, 403, 'Codigo de convite invalido');
        const existing = currentDb.memberships.find(
          (candidate) => candidate.poolId === poolId && candidate.userId === user.id,
        );
        if (existing) return existing;

        const created = { poolId, userId: user.id, joinedAt: new Date().toISOString() };
        currentDb.memberships.push(created);
        return created;
      });

      send(response, 200, { membership });
    }, { collections: ['users', 'pools', 'memberships'] }),

    route('DELETE', /^\/pools\/([^/]+)\/predictions\/([^/]+)$/, async (request, response, db, [, poolId, matchId]) => {
      const user = await requireFirebaseAuth(db, request);

      assert(
        db.memberships.some((m) => m.poolId === poolId && m.userId === user.id),
        403,
        'Voce nao participa deste bolao',
      );
      const match = findMatchByReference(db.matches, matchId);
      assert(match, 404, 'Jogo nao encontrado');
      assert(isPredictionOpen(match), 409, 'Palpites encerrados para este jogo');

      await store.transaction((currentDb) => {
        const currentMatch = findMatchByReference(currentDb.matches, matchId);
        const idx = currentDb.predictions.findIndex(
          (p) => p.poolId === poolId
            && p.userId === user.id
            && currentMatch
            && predictionBelongsToMatch(p, currentMatch),
        );
        assert(idx !== -1, 404, 'Palpite nao encontrado');
        currentDb.predictions.splice(idx, 1);
        return null;
      });

      send(response, 200, { ok: true });
    }, { collections: ['users', 'memberships', 'matches', 'predictions'] }),

    route('POST', /^\/pools\/([^/]+)\/predictions$/, async (request, response, db, [, poolId]) => {
      const user = await requireFirebaseAuth(db, request);
      const body = await readJson(request);
      const matchId = requireString(body.matchId, 'matchId');
      const homeGoals = requireInteger(body.homeGoals, 'homeGoals', 0);
      const awayGoals = requireInteger(body.awayGoals, 'awayGoals', 0);

      const prediction = await store.transaction((currentDb) => {
        assert(currentDb.pools.some((pool) => pool.id === poolId), 404, 'Bolao nao encontrado');
        assert(
          currentDb.memberships.some((membership) => membership.poolId === poolId && membership.userId === user.id),
          403,
          'Voce nao participa deste bolao',
        );
        const match = findMatchByReference(currentDb.matches, matchId);
        assert(match, 404, 'Jogo nao encontrado');
        assert(hasMatchTeamsDefined(match), 409, 'Jogo ainda sem times definidos para apostas');
        assert(isPredictionOpen(match), 409, 'Palpites encerrados para este jogo');

        const existing = currentDb.predictions.find(
          (candidate) => candidate.poolId === poolId
            && candidate.userId === user.id
            && predictionBelongsToMatch(candidate, match),
        );
        if (existing) {
          existing.matchId = match.id;
          existing.homeGoals = homeGoals;
          existing.awayGoals = awayGoals;
          existing.updatedAt = new Date().toISOString();
          return existing;
        }

        const created = {
          id: newId('pred'),
          poolId,
          userId: user.id,
          matchId: match.id,
          homeGoals,
          awayGoals,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        currentDb.predictions.push(created);
        return created;
      });

      send(response, 200, { prediction });
    }, { collections: ['users', 'pools', 'memberships', 'matches', 'predictions'] }),

    route('GET', /^\/pools\/([^/]+)\/predictions$/, async (request, response, db, [, poolId]) => {
      const user = await requireFirebaseAuth(db, request);
      assert(
        db.memberships.some((membership) => membership.poolId === poolId && membership.userId === user.id),
        403,
        'Voce nao participa deste bolao',
      );

      const predictions = db.predictions
        .filter((prediction) => prediction.poolId === poolId && prediction.userId === user.id)
        .map((prediction) => {
          const match = findMatchByReference(db.matches, prediction.matchId);
          return {
            ...prediction,
            matchId: match?.id ?? prediction.matchId,
            legacyMatchId: match && match.id !== prediction.matchId ? prediction.matchId : undefined,
            points: match ? scorePrediction(match, prediction) : 0,
          };
        });

      send(response, 200, { predictions });
    }, { collections: ['users', 'memberships', 'matches', 'predictions'] }),

    route('GET', /^\/pools\/([^/]+)\/matches\/([^/]+)\/predictions$/, async (request, response, db, [, poolId, matchId]) => {
      const user = await requireFirebaseAuth(db, request);
      assert(
        db.memberships.some((m) => m.poolId === poolId && m.userId === user.id),
        403, 'Voce nao participa deste bolao',
      );
      const match = findMatchByReference(db.matches, matchId);
      assert(match, 404, 'Jogo nao encontrado');
      const hasStarted = match.startsAt && new Date(match.startsAt).getTime() <= Date.now();
      assert(
        match.status === 'live' || match.status === 'finished' || hasStarted,
        403,
        'Palpites visiveis somente apos inicio do jogo',
      );

      const predictions = db.predictions
        .filter((p) => p.poolId === poolId && predictionBelongsToMatch(p, match))
        .map((p) => {
          const predUser = db.users.find((u) => u.id === p.userId);
          return {
            userId:    p.userId,
            userName:  predUser?.name ?? 'Usuário',
            homeGoals: p.homeGoals,
            awayGoals: p.awayGoals,
            points:    scorePrediction(match, p),
          };
        })
        .sort((a, b) => b.points - a.points || a.userName.localeCompare(b.userName));

      send(response, 200, { predictions });
    }, { collections: ['users', 'memberships', 'matches', 'predictions'] }),

    route('GET', /^\/pools\/([^/]+)\/leaderboard$/, async (request, response, db, [, poolId]) => {
      const user = await requireFirebaseAuth(db, request);
      assert(
        db.memberships.some((membership) => membership.poolId === poolId && membership.userId === user.id),
        403,
        'Voce nao participa deste bolao',
      );
      send(response, 200, { leaderboard: buildLeaderboard(db, poolId) });
    }, { collections: ['users', 'memberships', 'matches', 'predictions'] }),
  ];

  return async function router(request, response) {
    const url = parseUrl(request);
    // allow routes to be called with optional `/api` prefix (e.g. `/api/matches`)
    const pathname = url.pathname.startsWith('/api') ? url.pathname.slice(4) || '/' : url.pathname;
    if (request.method === 'GET' && pathname === '/health') {
      send(response, 200, { status: 'ok' });
      return;
    }

    const found = routes.find((candidate) => candidate.method === request.method && candidate.pattern.test(pathname));
    if (!found) return notFound();
    const db = found.collections && typeof store.loadCollections === 'function'
      ? await store.loadCollections(found.collections)
      : await store.load();
    const match = found.pattern.exec(pathname);
    // attach adjusted pathname back to request.url so helpers (parseUrl) continue to work
    const originalUrl = request.url;
    try {
      request.url = request.url.replace(url.pathname, pathname);
      const result = await found.handler(request, response, db, match);
      if (db.__dirty) {
        await store.save();
        db.__dirty = false;
      }
      return result;
    } finally {
      request.url = originalUrl;
    }
  };
}
