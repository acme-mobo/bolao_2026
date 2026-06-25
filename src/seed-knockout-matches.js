import { store } from './store.js';
import { worldCup2026KnockoutMatches } from './world-cup-2026-data.js';

const ROUND_OF_32_SLOTS = {
  73: { home: { group: 'A', rank: 2 }, away: { group: 'B', rank: 2 } },
  74: { home: { group: 'E', rank: 1 } },
  75: { home: { group: 'F', rank: 1 }, away: { group: 'C', rank: 2 } },
  76: { home: { group: 'C', rank: 1 }, away: { group: 'F', rank: 2 } },
  77: { home: { group: 'I', rank: 1 } },
  78: { home: { group: 'E', rank: 2 }, away: { group: 'I', rank: 2 } },
  79: { home: { group: 'A', rank: 1 } },
  80: { home: { group: 'L', rank: 1 } },
  81: { home: { group: 'D', rank: 1 } },
  82: { home: { group: 'G', rank: 1 } },
  83: { home: { group: 'K', rank: 2 }, away: { group: 'L', rank: 2 } },
  84: { home: { group: 'H', rank: 1 }, away: { group: 'J', rank: 2 } },
  85: { home: { group: 'B', rank: 1 } },
  86: { home: { group: 'J', rank: 1 }, away: { group: 'H', rank: 2 } },
  87: { home: { group: 'K', rank: 1 } },
  88: { home: { group: 'D', rank: 2 }, away: { group: 'G', rank: 2 } },
};

function buildCompletedGroupTables(db) {
  const teamsById = new Map(db.teams.map((team) => [team.id, team]));
  const matchesByGroup = new Map();

  for (const match of db.matches) {
    if (match.stage !== 'group' || !match.group) continue;
    if (match.status !== 'finished') continue;
    if (!Number.isInteger(match.homeGoals) || !Number.isInteger(match.awayGoals)) continue;

    const groupMatches = matchesByGroup.get(match.group) ?? [];
    groupMatches.push(match);
    matchesByGroup.set(match.group, groupMatches);
  }

  const tables = new Map();
  for (const [group, matches] of matchesByGroup.entries()) {
    if (matches.length < 6) continue;

    const rows = new Map();
    const ensureRow = (teamId) => {
      const team = teamsById.get(teamId);
      if (!team) return null;
      if (!rows.has(teamId)) {
        rows.set(teamId, {
          team,
          played: 0,
          points: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          goalsDiff: 0,
        });
      }
      return rows.get(teamId);
    };

    for (const match of matches) {
      const home = ensureRow(match.homeTeamId);
      const away = ensureRow(match.awayTeamId);
      if (!home || !away) continue;

      home.played++;
      away.played++;
      home.goalsFor += match.homeGoals;
      home.goalsAgainst += match.awayGoals;
      away.goalsFor += match.awayGoals;
      away.goalsAgainst += match.homeGoals;
      home.goalsDiff = home.goalsFor - home.goalsAgainst;
      away.goalsDiff = away.goalsFor - away.goalsAgainst;

      if (match.homeGoals > match.awayGoals) home.points += 3;
      else if (match.homeGoals < match.awayGoals) away.points += 3;
      else {
        home.points++;
        away.points++;
      }
    }

    const table = [...rows.values()]
      .filter((row) => row.played === 3)
      .sort((a, b) => b.points - a.points
        || b.goalsDiff - a.goalsDiff
        || b.goalsFor - a.goalsFor
        || a.team.name.localeCompare(b.team.name));

    if (table.length === 4) tables.set(group, table);
  }

  return tables;
}

function resolvedTeamForSlot(slot, completedGroupTables) {
  if (!slot) return null;
  const table = completedGroupTables.get(slot.group);
  return table?.[slot.rank - 1]?.team ?? null;
}

function buildKnockoutMatch(match, teamsByCode, completedGroupTables, existing = null) {
  const slot = ROUND_OF_32_SLOTS[match.matchNumber] ?? {};
  const resolvedHome = resolvedTeamForSlot(slot.home, completedGroupTables);
  const resolvedAway = resolvedTeamForSlot(slot.away, completedGroupTables);
  const home = resolvedHome ?? (match.homeCode ? teamsByCode.get(match.homeCode) : null);
  const away = resolvedAway ?? (match.awayCode ? teamsByCode.get(match.awayCode) : null);
  const now = new Date().toISOString();

  return {
    ...(existing ?? {}),
    id: existing?.id ?? `match_${match.matchNumber}`,
    matchNumber: match.matchNumber,
    homeTeamId: home?.id ?? existing?.homeTeamId ?? null,
    awayTeamId: away?.id ?? existing?.awayTeamId ?? null,
    homeSlot: match.homeSlot ?? home?.name ?? existing?.homeSlot ?? null,
    awaySlot: match.awaySlot ?? away?.name ?? existing?.awaySlot ?? null,
    stage: match.stage,
    group: null,
    startsAt: match.startsAt,
    lockAt: existing?.lockAt ?? match.startsAt,
    venue: match.venue,
    city: match.city,
    status: existing?.status ?? 'scheduled',
    homeGoals: existing?.homeGoals ?? null,
    awayGoals: existing?.awayGoals ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

await store.load();

const result = await store.transaction((db) => {
  const teamsByCode = new Map(db.teams.map((team) => [team.code, team]));
  const completedGroupTables = buildCompletedGroupTables(db);
  let created = 0;
  let updated = 0;

  for (const match of worldCup2026KnockoutMatches) {
    const existingIndex = db.matches.findIndex(
      (candidate) => candidate.matchNumber === match.matchNumber || candidate.id === `match_${match.matchNumber}`,
    );
    const nextMatch = buildKnockoutMatch(match, teamsByCode, completedGroupTables, db.matches[existingIndex] ?? null);

    if (existingIndex >= 0) {
      db.matches[existingIndex] = nextMatch;
      updated++;
    } else {
      db.matches.push(nextMatch);
      created++;
    }
  }

  db.matches.sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0));
  return { created, updated, totalMatches: db.matches.length };
});

console.log(JSON.stringify({
  store: store.kind,
  knockoutMatches: worldCup2026KnockoutMatches.length,
  ...result,
}, null, 2));
