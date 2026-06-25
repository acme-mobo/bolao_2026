import assert from 'node:assert/strict';
import test from 'node:test';
import {
  worldCup2026GroupMatches,
  worldCup2026KnockoutMatches,
  worldCup2026Matches,
  worldCup2026Teams,
} from '../src/world-cup-2026-data.js';

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

test('seed oficial tem calendario dos 32 jogos de mata-mata', () => {
  const codes = new Set(worldCup2026Teams.map(([, code]) => code));
  assert.equal(worldCup2026KnockoutMatches.length, 32);
  assert.equal(worldCup2026Matches.length, 104);

  const expectedStages = new Map([
    ['round-of-32', 16],
    ['round-of-16', 8],
    ['quarter-final', 4],
    ['semi-final', 2],
    ['third-place', 1],
    ['final', 1],
  ]);
  const stageCounts = new Map();

  for (const match of worldCup2026KnockoutMatches) {
    assert.equal(Number.isInteger(match.matchNumber), true);
    assert.equal(match.matchNumber >= 73 && match.matchNumber <= 104, true);
    assert.equal(Number.isNaN(new Date(match.startsAt).getTime()), false);
    assert.equal(typeof match.venue, 'string');
    assert.equal(typeof match.city, 'string');
    assert.equal(typeof match.homeSlot, 'string');
    assert.equal(typeof match.awaySlot, 'string');
    if (match.homeCode) assert.equal(codes.has(match.homeCode), true);
    if (match.awayCode) assert.equal(codes.has(match.awayCode), true);
    stageCounts.set(match.stage, (stageCounts.get(match.stage) ?? 0) + 1);
  }

  assert.deepEqual(stageCounts, expectedStages);
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
