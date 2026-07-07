import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { asyncHandler } from '../../../src/http.js';
import { createRouter } from '../../../src/routes.js';
import { store } from '../../../src/store.js';

const router = asyncHandler(createRouter(store));

function createNodeRequest(request, params) {
  const url = new URL(request.url);
  const body = request.body ? Readable.fromWeb(request.body) : Readable.from([]);
  body.method = request.method;
  body.url = `/${params.path.join('/')}${url.search}`;
  body.headers = Object.fromEntries(request.headers.entries());
  body.headers.host = body.headers.host ?? url.host;
  return body;
}

function createNodeResponse() {
  const response = new EventEmitter();
  response.statusCode = 200;
  response.headers = new Headers();
  response.setHeader = (name, value) => response.headers.set(name, value);
  response.end = (payload = '') => {
    response.payload = payload;
    response.emit('finish');
  };
  return response;
}

async function handle(request, context) {
  const params = await context.params;
  const nodeRequest = createNodeRequest(request, params);
  const nodeResponse = createNodeResponse();
  const finished = new Promise((resolve) => nodeResponse.once('finish', resolve));

  await router(nodeRequest, nodeResponse);
  await finished;

  return new Response(nodeResponse.payload ?? '', {
    status: nodeResponse.statusCode,
    headers: nodeResponse.headers,
  });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
