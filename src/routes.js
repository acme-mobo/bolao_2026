import { createToken, deleteFirebaseAuthUser, hashPassword, requireAdmin, requireFirebaseAuth, verifyPassword } from './auth.js';
import { assert } from './errors.js';
import { newId } from './id.js';
import { notFound, parseUrl, readJson, sanitizeUser, send } from './http.js';
import { FootballDataLiveScoreProvider, syncLiveScores } from './live-score.js';
import { buildLeaderboard, scorePrediction } from './scoring.js';
import { optionalDate, requireEmail, requireInteger, requireString } from './validation.js';

function route(method, pattern, handler) {
  return { method, pattern, handler };
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
  return [...new Set(db.teams.map((team) => team.group).filter(Boolean))]
    .sort()
    .map((group) => ({
      group,
      teams: db.teams.filter((team) => team.group === group),
      matches: db.matches
        .filter((match) => match.group === group)
        .sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0)),
    }));
}

export function createRouter(store, options = {}) {
  const liveScoreProvider = options.liveScoreProvider ?? new FootballDataLiveScoreProvider();
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
    }),

    route('POST', /^\/auth\/login$/, async (request, response, db) => {
      const body = await readJson(request);
      const email = requireEmail(body.email);
      const password = requireString(body.password, 'password');
      const user = db.users.find((candidate) => candidate.email === email);
      assert(user && verifyPassword(password, user.passwordHash), 401, 'Credenciais invalidas');
      send(response, 200, { user: sanitizeUser(user), token: createToken(user) });
    }),

    route('GET', /^\/me$/, async (request, response, db) => {
      const user = await requireFirebaseAuth(db, request);
      send(response, 200, { user: sanitizeUser(user) });
    }),

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
    }),

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
    }),

    route('GET', /^\/groups$/, (_request, response, db) => {
      send(response, 200, { groups: buildGroups(db) });
    }),

    route('GET', /^\/groups\/([A-L])$/, (_request, response, db, [, group]) => {
      const found = buildGroups(db).find((candidate) => candidate.group === group);
      assert(found, 404, 'Grupo nao encontrado');
      send(response, 200, { group: found });
    }),

    route('GET', /^\/teams$/, (_request, response, db) => {
      send(response, 200, { teams: db.teams });
    }),

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
    }),

    route('GET', /^\/matches$/, (request, response, db) => {
      const status = parseUrl(request).searchParams.get('status');
      const matches = status ? db.matches.filter((match) => match.status === status) : db.matches;
      send(response, 200, { matches });
    }),

    route('GET', /^\/live-score\/provider$/, (_request, response) => {
      send(response, 200, liveScoreProvider.getStatus());
    }),

    route('POST', /^\/live-score\/sync$/, async (request, response, db) => {
      const user = await requireFirebaseAuth(db, request);
      requireAdmin(user);

      const result = await syncLiveScores(db, liveScoreProvider);
      await store.save();

      send(response, 200, result);
    }),

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
    }),

    route('PATCH', /^\/matches\/([^/]+)$/, async (request, response, db, [, matchId]) => {
      const user = await requireFirebaseAuth(db, request);
      requireAdmin(user);
      const body = await readJson(request);

      const match = await store.transaction((currentDb) => {
        const existing = currentDb.matches.find((candidate) => candidate.id === matchId);
        assert(existing, 404, 'Jogo nao encontrado');

        if (body.startsAt !== undefined) existing.startsAt = optionalDate(body.startsAt, 'startsAt');
        if (body.lockAt !== undefined) existing.lockAt = optionalDate(body.lockAt, 'lockAt');
        if (body.status !== undefined) {
          assert(['scheduled', 'live', 'finished', 'cancelled'].includes(body.status), 400, 'Status invalido');
          existing.status = body.status;
        }
        if (body.homeGoals !== undefined) existing.homeGoals = requireInteger(body.homeGoals, 'homeGoals', 0);
        if (body.awayGoals !== undefined) existing.awayGoals = requireInteger(body.awayGoals, 'awayGoals', 0);
        if (existing.homeGoals !== null && existing.awayGoals !== null) existing.status = 'finished';

        return existing;
      });

      send(response, 200, { match });
    }),

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
    }),

    route('GET', /^\/pools\/active$/, async (request, response, db) => {
      const user = await requireFirebaseAuth(db, request);
      const pool = await store.transaction((currentDb) => ensureActivePool(currentDb, user));
      send(response, 200, { pool: publicPool(pool) });
    }),

    route('GET', /^\/pools$/, async (request, response, db) => {
      const user = await requireFirebaseAuth(db, request);
      const pool = await store.transaction((currentDb) => ensureActivePool(currentDb, user));
      send(response, 200, { pools: [publicPool(pool)] });
    }),

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
    }),

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
    }),

    route('DELETE', /^\/pools\/([^/]+)\/predictions\/([^/]+)$/, async (request, response, db, [, poolId, matchId]) => {
      const user = await requireFirebaseAuth(db, request);

      assert(
        db.memberships.some((m) => m.poolId === poolId && m.userId === user.id),
        403,
        'Voce nao participa deste bolao',
      );
      const match = db.matches.find((m) => m.id === matchId);
      assert(match, 404, 'Jogo nao encontrado');
      assert(new Date(match.lockAt).getTime() > Date.now(), 409, 'Palpites encerrados para este jogo');

      await store.transaction((currentDb) => {
        const idx = currentDb.predictions.findIndex(
          (p) => p.poolId === poolId && p.userId === user.id && p.matchId === matchId,
        );
        assert(idx !== -1, 404, 'Palpite nao encontrado');
        currentDb.predictions.splice(idx, 1);
        return null;
      });

      send(response, 200, { ok: true });
    }),

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
        const match = currentDb.matches.find((candidate) => candidate.id === matchId);
        assert(match, 404, 'Jogo nao encontrado');
        assert(new Date(match.lockAt).getTime() > Date.now(), 409, 'Palpites encerrados para este jogo');

        const existing = currentDb.predictions.find(
          (candidate) => candidate.poolId === poolId && candidate.userId === user.id && candidate.matchId === matchId,
        );
        if (existing) {
          existing.homeGoals = homeGoals;
          existing.awayGoals = awayGoals;
          existing.updatedAt = new Date().toISOString();
          return existing;
        }

        const created = {
          id: newId('pred'),
          poolId,
          userId: user.id,
          matchId,
          homeGoals,
          awayGoals,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        currentDb.predictions.push(created);
        return created;
      });

      send(response, 200, { prediction });
    }),

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
          const match = db.matches.find((candidate) => candidate.id === prediction.matchId);
          return { ...prediction, points: match ? scorePrediction(match, prediction) : 0 };
        });

      send(response, 200, { predictions });
    }),

    route('GET', /^\/pools\/([^/]+)\/leaderboard$/, async (request, response, db, [, poolId]) => {
      const user = await requireFirebaseAuth(db, request);
      assert(
        db.memberships.some((membership) => membership.poolId === poolId && membership.userId === user.id),
        403,
        'Voce nao participa deste bolao',
      );
      send(response, 200, { leaderboard: buildLeaderboard(db, poolId) });
    }),
  ];

  return async function router(request, response) {
    const url = parseUrl(request);
    if (request.method === 'GET' && url.pathname === '/health') {
      send(response, 200, { status: 'ok' });
      return;
    }

    const db = await store.load();
    const found = routes.find((candidate) => candidate.method === request.method && candidate.pattern.test(url.pathname));
    if (!found) return notFound();
    const match = found.pattern.exec(url.pathname);
    const result = await found.handler(request, response, db, match);
    if (db.__dirty) {
      await store.save();
      db.__dirty = false;
    }
    return result;
  };
}
