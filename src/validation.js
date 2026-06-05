import { assert } from './errors.js';

export function requireString(value, field, min = 1) {
  assert(typeof value === 'string' && value.trim().length >= min, 400, `Campo ${field} invalido`);
  return value.trim();
}

export function requireEmail(value) {
  const email = requireString(value, 'email').toLowerCase();
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 400, 'Email invalido');
  return email;
}

export function requireInteger(value, field, min = undefined) {
  assert(Number.isInteger(value), 400, `Campo ${field} deve ser inteiro`);
  if (min !== undefined) assert(value >= min, 400, `Campo ${field} deve ser >= ${min}`);
  return value;
}

export function optionalDate(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(value);
  assert(!Number.isNaN(date.getTime()), 400, `Campo ${field} deve ser uma data valida`);
  return date.toISOString();
}
