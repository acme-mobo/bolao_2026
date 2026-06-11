import { config } from '../../../../src/config.js';
import { seedLocalFixtures } from '../../../../src/wc-sync.js';

export const dynamic = 'force-dynamic';

function authorized(request) {
  const secret = config.apiFootballSyncSecret;
  if (!secret) return true;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

function seedJson(payload, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('cache-control', 'no-store, max-age=0');
  return Response.json(payload, { ...init, headers });
}

// POST /api/sync/seed — popula Firestore com os 72 jogos da fase de grupos
export async function POST(request) {
  if (!authorized(request)) {
    return seedJson({ error: 'Não autorizado' }, { status: 401 });
  }
  try {
    const result = await seedLocalFixtures();
    return seedJson(result);
  } catch (err) {
    return seedJson({ error: err.message }, { status: 500 });
  }
}
