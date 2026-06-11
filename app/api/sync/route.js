import { config } from '../../../src/config.js';
import { createLiveScoreProvider } from '../../../src/live-score.js';
import { buildCompactSyncResponse, getSyncStatus, orchestrate } from '../../../src/wc-sync.js';

export const dynamic = 'force-dynamic';

function authorized(request) {
  const secret = config.apiFootballSyncSecret;
  if (!secret) return true; // dev: sem secret = aberto
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

// GET /api/sync — status atual (usado pelo cron e pelo admin)
export async function GET(request) {
  if (!authorized(request)) {
    return Response.json({ error: 'Não autorizado' }, { status: 401 });
  }
  try {
    const status = await getSyncStatus();
    return Response.json(status);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/sync — dispara sincronização (chamado pelo cron ou manualmente)
export async function POST(request) {
  if (!authorized(request)) {
    return Response.json({ error: 'Não autorizado' }, { status: 401 });
  }
  try {
    const url = new URL(request.url);
    const verbose = url.searchParams.get('verbose') === '1'
      || request.headers.get('x-sync-verbose') === '1';
    const providerStatus = createLiveScoreProvider().getStatus();
    const result = await orchestrate();
    return Response.json(verbose ? result : buildCompactSyncResponse(result, providerStatus));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
