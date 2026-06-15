import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLeaderboard,
  CORRECT_OUTCOME_POINTS,
  EXACT_SCORE_POINTS,
  hasMatchResult,
  isExactScore,
  scorePrediction,
} from '../src/scoring.js';

const win = { homeGoals: 2, awayGoals: 1 };

test('vitória — placar exato vale 5', () => {
  const prediction = { homeGoals: 2, awayGoals: 1 };

  assert.equal(scorePrediction(win, prediction), EXACT_SCORE_POINTS);
  assert.equal(isExactScore(win, prediction), true);
});

test('vitória — vencedor correto com placar diferente vale 3', () => {
  assert.equal(scorePrediction(win, { homeGoals: 3, awayGoals: 2 }), CORRECT_OUTCOME_POINTS);
  assert.equal(scorePrediction(win, { homeGoals: 1, awayGoals: 0 }), CORRECT_OUTCOME_POINTS);
  assert.equal(scorePrediction(win, { homeGoals: 3, awayGoals: 0 }), CORRECT_OUTCOME_POINTS);
});

test('vitória — resultado errado vale 0', () => {
  assert.equal(scorePrediction(win, { homeGoals: 0, awayGoals: 2 }), 0);
});

test('vitória — empate apostado vale 0', () => {
  assert.equal(scorePrediction(win, { homeGoals: 1, awayGoals: 1 }), 0);
});

const draw = { homeGoals: 1, awayGoals: 1 };

test('empate — placar exato vale 5', () => {
  assert.equal(scorePrediction(draw, { homeGoals: 1, awayGoals: 1 }), EXACT_SCORE_POINTS);
});

test('empate — empate com placar diferente vale 3', () => {
  assert.equal(scorePrediction(draw, { homeGoals: 0, awayGoals: 0 }), CORRECT_OUTCOME_POINTS);
  assert.equal(scorePrediction(draw, { homeGoals: 2, awayGoals: 2 }), CORRECT_OUTCOME_POINTS);
});

test('empate — apostou vitória vale 0', () => {
  assert.equal(scorePrediction(draw, { homeGoals: 2, awayGoals: 1 }), 0);
});

test('sem resultado vale 0', () => {
  assert.equal(scorePrediction({ homeGoals: null, awayGoals: null }, { homeGoals: 1, awayGoals: 1 }), 0);
  assert.equal(hasMatchResult({ homeGoals: 1, awayGoals: null }), false);
  assert.equal(isExactScore({ homeGoals: null, awayGoals: null }, { homeGoals: null, awayGoals: null }), false);
});

test('ranking desempata por placares exatos', () => {
  const db = {
    users: [
      { id: 'user_a', name: 'Ana' },
      { id: 'user_b', name: 'Bruno' },
    ],
    memberships: [
      { poolId: 'pool', userId: 'user_a' },
      { poolId: 'pool', userId: 'user_b' },
    ],
    matches: [
      { id: 'match_1', homeGoals: 1, awayGoals: 0 },
      { id: 'match_2', homeGoals: 1, awayGoals: 0 },
      { id: 'match_3', homeGoals: 1, awayGoals: 0 },
      { id: 'match_4', homeGoals: 1, awayGoals: 0 },
      { id: 'match_5', homeGoals: 1, awayGoals: 0 },
    ],
    predictions: [
      { poolId: 'pool', userId: 'user_a', matchId: 'match_1', homeGoals: 1, awayGoals: 0 },
      { poolId: 'pool', userId: 'user_a', matchId: 'match_2', homeGoals: 1, awayGoals: 0 },
      { poolId: 'pool', userId: 'user_a', matchId: 'match_3', homeGoals: 1, awayGoals: 0 },
      { poolId: 'pool', userId: 'user_a', matchId: 'match_4', homeGoals: 0, awayGoals: 1 },
      { poolId: 'pool', userId: 'user_a', matchId: 'match_5', homeGoals: 0, awayGoals: 1 },
      { poolId: 'pool', userId: 'user_b', matchId: 'match_1', homeGoals: 2, awayGoals: 0 },
      { poolId: 'pool', userId: 'user_b', matchId: 'match_2', homeGoals: 2, awayGoals: 0 },
      { poolId: 'pool', userId: 'user_b', matchId: 'match_3', homeGoals: 2, awayGoals: 0 },
      { poolId: 'pool', userId: 'user_b', matchId: 'match_4', homeGoals: 2, awayGoals: 0 },
      { poolId: 'pool', userId: 'user_b', matchId: 'match_5', homeGoals: 2, awayGoals: 0 },
    ],
  };

  const leaderboard = buildLeaderboard(db, 'pool');

  assert.equal(leaderboard[0].userId, 'user_a');
  assert.equal(leaderboard[0].points, 15);
  assert.equal(leaderboard[0].exactCount, 3);
  assert.equal(leaderboard[1].points, 15);
  assert.equal(leaderboard[1].exactCount, 0);
});
