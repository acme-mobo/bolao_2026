import assert from 'node:assert/strict';
import test from 'node:test';
import { scorePrediction } from '../src/scoring.js';

const match = { homeGoals: 2, awayGoals: 1 };

test('pontua placar exato', () => {
  assert.equal(scorePrediction(match, { homeGoals: 2, awayGoals: 1 }), 25);
});

test('pontua vencedor e gols parciais', () => {
  assert.equal(scorePrediction(match, { homeGoals: 2, awayGoals: 0 }), 12);
});

test('pontua diferenca sem placar exato', () => {
  assert.equal(scorePrediction(match, { homeGoals: 3, awayGoals: 2 }), 15);
});

test('nao pontua jogo sem resultado', () => {
  assert.equal(scorePrediction({ homeGoals: null, awayGoals: null }, { homeGoals: 1, awayGoals: 1 }), 0);
});
