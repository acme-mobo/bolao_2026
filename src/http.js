import { HttpError } from './errors.js';

export async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'JSON invalido');
  }
}

export function send(response, status, payload = undefined) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(payload === undefined ? '' : JSON.stringify(payload));
}

export function notFound() {
  throw new HttpError(404, 'Rota nao encontrada');
}

export function sanitizeUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

export function parseUrl(request) {
  return new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
}

export function asyncHandler(handler) {
  return async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : 'Erro interno';
      send(response, status, {
        error: {
          message,
          details: error.details,
        },
      });
      if (!(error instanceof HttpError)) {
        console.error(error);
      }
    }
  };
}
