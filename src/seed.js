import { newId } from './id.js';
import { store } from './store.js';
import { worldCup2026GroupMatches, worldCup2026Teams } from './world-cup-2026-data.js';

await store.load();
await store.transaction((db) => {
  db.users = [];
  db.teams = worldCup2026Teams.map(([name, code, group]) => ({ id: newId('team'), name, code, group }));
  db.matches = worldCup2026GroupMatches.map(([matchNumber, group, homeCode, awayCode, startsAt, venue, city]) => {
    const home = db.teams.find((team) => team.code === homeCode);
    const away = db.teams.find((team) => team.code === awayCode);
    return {
      id: newId('match'),
      matchNumber,
      homeTeamId: home.id,
      awayTeamId: away.id,
      stage: 'group',
      group,
      startsAt,
      lockAt: startsAt,
      venue,
      city,
      status: 'scheduled',
      homeGoals: null,
      awayGoals: null,
      createdAt: new Date().toISOString(),
    };
  });
  db.pools = [];
  db.memberships = [];
  db.predictions = [];
});

console.log(
  `Seed gerado em ${store.kind}: ${worldCup2026Teams.length} selecoes e ${worldCup2026GroupMatches.length} jogos.`,
);
