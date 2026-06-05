import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { HttpError, assert } from './errors.js';
import { getAdminAuth } from './firebase-admin.js';

const encoder = new TextEncoder();

function base64url(input) {
  const data = typeof input === 'string' ? input : JSON.stringify(input);
  return Buffer.from(data).toString('base64url');
}

function sign(data) {
  return createHmac('sha256', config.jwtSecret).update(data).digest('base64url');
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(password, salt, 64).toString('base64url');
  return `${salt}.${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split('.');
  if (!salt || !hash) return false;

  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'base64url');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createToken(user) {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64url({
    sub: user.id,
    role: user.role,
    name: user.name,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  });
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign(unsigned)}`;
}

export function verifyToken(token) {
  const parts = token?.split('.');
  assert(parts?.length === 3, 401, 'Token invalido');

  const [header, payload, signature] = parts;
  const unsigned = `${header}.${payload}`;
  const expected = sign(unsigned);
  const actualBytes = encoder.encode(signature);
  const expectedBytes = encoder.encode(expected);

  assert(
    actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes),
    401,
    'Token invalido',
  );

  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  assert(!claims.exp || claims.exp >= Math.floor(Date.now() / 1000), 401, 'Token expirado');
  return claims;
}

export function requireAuth(db, request) {
  const header = request.headers.authorization ?? '';
  const [type, token] = header.split(' ');
  assert(type === 'Bearer' && token, 401, 'Autenticacao obrigatoria');

  const claims = verifyToken(token);
  const user = db.users.find((candidate) => candidate.id === claims.sub);
  assert(user, 401, 'Usuario nao encontrado');
  return user;
}

export async function requireFirebaseAuth(db, request) {
  const header = request.headers.authorization ?? '';
  const [type, token] = header.split(' ');
  assert(type === 'Bearer' && token, 401, 'Autenticacao obrigatoria');

  if (!['firestore', 'firebase'].includes(config.dataStore)) {
    return requireAuth(db, request);
  }

  const decoded = await getAdminAuth().verifyIdToken(token);
  let user = db.users.find((candidate) => candidate.id === decoded.uid);
  if (!user) {
    user = {
      id: decoded.uid,
      name: decoded.name ?? '',   // preenchido pelo PATCH /me no fluxo de cadastro
      email: decoded.email ?? '',
      role: db.users.length === 0 ? 'admin' : 'player',
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    Object.defineProperty(db, '__dirty', { value: true, enumerable: false, configurable: true, writable: true });
  } else if (decoded.name && decoded.name !== user.name) {
    // Sincroniza displayName de um token Firebase atualizado.
    user.name = decoded.name;
    Object.defineProperty(db, '__dirty', { value: true, enumerable: false, configurable: true, writable: true });
  }
  return user;
}

export async function deleteFirebaseAuthUser(uid) {
  if (!['firestore', 'firebase'].includes(config.dataStore)) return;
  await getAdminAuth().deleteUser(uid);
}

export function requireAdmin(user) {
  if (user.role !== 'admin') {
    throw new HttpError(403, 'Acesso restrito a administradores');
  }
}
