import assert from 'node:assert/strict';
import test from 'node:test';
import { scorePrediction } from '../src/scoring.js';

// ─── Vitória do mandante: 2 × 1 ──────────────────────
const win = { homeGoals: 2, awayGoals: 1 };

test('vitória — placar exato → 25', () => {
  assert.equal(scorePrediction(win, { homeGoals: 2, awayGoals: 1 }), 25);
});

test('vitória — vencedor + saldo (3×2) → 18', () => {
  assert.equal(scorePrediction(win, { homeGoals: 3, awayGoals: 2 }), 18);
});

test('vitória — vencedor + saldo (1×0) → 18', () => {
  // diff = +1 em ambos
  assert.equal(scorePrediction(win, { homeGoals: 1, awayGoals: 0 }), 18);
});

test('vitória — vencedor + gols do mandante (2×0) → 15', () => {
  assert.equal(scorePrediction(win, { homeGoals: 2, awayGoals: 0 }), 15);
});

test('vitória — vencedor + gols do visitante (3×1) → 15', () => {
  assert.equal(scorePrediction(win, { homeGoals: 3, awayGoals: 1 }), 15);
});

test('vitória — só o vencedor (3×0) → 10', () => {
  assert.equal(scorePrediction(win, { homeGoals: 3, awayGoals: 0 }), 10);
});

test('vitória — resultado errado → 0', () => {
  assert.equal(scorePrediction(win, { homeGoals: 0, awayGoals: 2 }), 0);
});

test('vitória — empate apostado → 0', () => {
  assert.equal(scorePrediction(win, { homeGoals: 1, awayGoals: 1 }), 0);
});

// ─── Empate: 1 × 1 ───────────────────────────────────
const draw = { homeGoals: 1, awayGoals: 1 };

test('empate — placar exato → 25', () => {
  assert.equal(scorePrediction(draw, { homeGoals: 1, awayGoals: 1 }), 25);
});

test('empate — acertou empate, placar diferente (0×0) → 10', () => {
  assert.equal(scorePrediction(draw, { homeGoals: 0, awayGoals: 0 }), 10);
});

test('empate — acertou empate, placar diferente (2×2) → 10', () => {
  assert.equal(scorePrediction(draw, { homeGoals: 2, awayGoals: 2 }), 10);
});

test('empate — apostou vitória → 0', () => {
  assert.equal(scorePrediction(draw, { homeGoals: 2, awayGoals: 1 }), 0);
});

// ─── Jogo sem resultado ───────────────────────────────
test('sem resultado → 0', () => {
  assert.equal(scorePrediction({ homeGoals: null, awayGoals: null }, { homeGoals: 1, awayGoals: 1 }), 0);
});
