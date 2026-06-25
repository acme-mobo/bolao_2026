import { store } from './store.js';
import {
  worldCup2026GroupMatches,
  worldCup2026KnockoutMatches,
  worldCup2026Matches,
  worldCup2026Teams,
} from './world-cup-2026-data.js';

export function buildWorldCup2026Match(match, teamsByCode, createdAt = new Date().toISOString()) {
  const home = match.homeCode ? teamsByCode.get(match.homeCode) : null;
  const away = match.awayCode ? teamsByCode.get(match.awayCode) : null;

  return {
    id: `match_${match.matchNumber}`,
    matchNumber: match.matchNumber,
    homeTeamId: home?.id ?? null,
    awayTeamId: away?.id ?? null,
    homeSlot: match.homeSlot ?? home?.name ?? null,
    awaySlot: match.awaySlot ?? away?.name ?? null,
    stage: match.stage,
    group: match.group ?? null,
    startsAt: match.startsAt,
    lockAt: match.startsAt,
    venue: match.venue,
    city: match.city,
    status: 'scheduled',
    homeGoals: null,
    awayGoals: null,
    createdAt,
  };
}

await store.load();
await store.transaction((db) => {
  const createdAt = new Date().toISOString();
  db.users = [];
  db.teams = worldCup2026Teams.map(([name, code, group]) => ({ id: `team_${code}`, name, code, group }));
  const teamsByCode = new Map(db.teams.map((team) => [team.code, team]));
  db.matches = worldCup2026Matches.map((match) => buildWorldCup2026Match(match, teamsByCode, createdAt));
  db.pools = [];
  db.memberships = [];
  db.predictions = [];
});

console.log(
  `Seed gerado em ${store.kind}: ${worldCup2026Teams.length} selecoes, ${worldCup2026GroupMatches.length} jogos de grupos e ${worldCup2026KnockoutMatches.length} jogos de mata-mata.`,
);
