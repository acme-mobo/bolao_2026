import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCompetitionSeed } from '../src/seed.js';

const example = {
  teams: [
    { name: 'Time Alfa', code: 'ALF', group: 'A' },
    { name: 'Time Beta', code: 'BET', group: 'A' },
  ],
  matches: [
    {
      matchNumber: 1,
      homeCode: 'ALF',
      awayCode: 'BET',
      group: 'A',
      startsAt: '2030-06-01T19:00:00.000Z',
    },
  ],
};

test('seed genérico normaliza times e jogos', () => {
  const seed = buildCompetitionSeed(example, '2030-01-01T00:00:00.000Z');

  assert.deepEqual(seed.teams.map((team) => team.id), ['team_ALF', 'team_BET']);
  assert.equal(seed.matches[0].id, 'match_1');
  assert.equal(seed.matches[0].homeTeamId, 'team_ALF');
  assert.equal(seed.matches[0].awayTeamId, 'team_BET');
  assert.equal(seed.matches[0].lockAt, example.matches[0].startsAt);
});

test('seed genérico rejeita referências a times inexistentes', () => {
  assert.throws(
    () => buildCompetitionSeed({
      ...example,
      matches: [{ ...example.matches[0], awayCode: 'XXX' }],
    }),
    /awayCode não encontrado/,
  );
});
