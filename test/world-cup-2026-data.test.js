import assert from 'node:assert/strict';
import test from 'node:test';
import { worldCup2026GroupMatches, worldCup2026Teams } from '../src/world-cup-2026-data.js';

test('seed oficial tem 48 selecoes em 12 grupos de 4', () => {
  assert.equal(worldCup2026Teams.length, 48);

  const counts = new Map();
  for (const [, , group] of worldCup2026Teams) {
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }

  assert.equal(counts.size, 12);
  for (const count of counts.values()) {
    assert.equal(count, 4);
  }
});

test('seed oficial tem 72 jogos de grupos com selecoes conhecidas', () => {
  const codes = new Set(worldCup2026Teams.map(([, code]) => code));
  assert.equal(worldCup2026GroupMatches.length, 72);

  for (const [matchNumber, group, homeCode, awayCode, startsAt, venue, city] of worldCup2026GroupMatches) {
    assert.equal(Number.isInteger(matchNumber), true);
    assert.match(group, /^[A-L]$/);
    assert.equal(codes.has(homeCode), true);
    assert.equal(codes.has(awayCode), true);
    assert.notEqual(homeCode, awayCode);
    assert.equal(Number.isNaN(new Date(startsAt).getTime()), false);
    assert.equal(typeof venue, 'string');
    assert.equal(typeof city, 'string');
  }
});
