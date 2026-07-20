import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from '../app/api/[...path]/route.js';

test('Next API route serializa erros do router como JSON', async () => {
  const response = await POST(
    new Request('http://localhost/api/pools/pool_main/predictions', { method: 'POST' }),
    { params: Promise.resolve({ path: ['pools', 'pool_main', 'predictions'] }) },
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await response.json(), {
    error: {
      message: 'Autenticacao obrigatoria',
    },
  });
});
