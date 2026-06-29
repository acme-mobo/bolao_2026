import { newId } from './id.js';
import { store } from './store.js';

const POOL_ID = 'pool_copa_2026';
const dryRun = process.argv.includes('--dry-run');

const matchOrder = [
  'RSA-CAN',
  'GER-PAR',
  'NED-MAR',
  'BRA-JPN',
  'FRA-SWE',
  'CIV-NOR',
  'MEX-ECU',
  'USA-BIH',
  'BEL-SEN',
  'POR-CRO',
  'ESP-AUT',
  'SUI-ALG',
  'ARG-CPV',
  'COL-GHA',
  'AUS-EGY',
  'ENG-COD',
];

const rows = [
  ['Branca', '- 2-1 1-1 2-1 2-0 2-0 2-1 3-0 1-3 2-0 2-0 0-0 3-1 2-0 1-1 4-2'],
  ['caiobosco', '0-2 5-1 3-2 4-2 3-1 2-1 2-2 3-1 - 2-2 3-0 2-0 2-0 2-1 1-2 4-0'],
  ['cido', '- 2-0 1-0 3-0 3-0 1-2 1-1 2-0 2-2 1-0 4-1 0-0 3-0 2-0 1-1 3-0'],
  ['edival', '2-1 2-0 2-1 3-2 3-1 2-1 2-1 1-2 1-2 1-2 2-1 2-1 2-1 2-1 2-2 2-1'],
  ['Edu', '0-1 2-1 1-1 2-0 3-1 2-1 2-2 2-0 1-2 3-0 3-0 0-2 4-1 1-0 2-2 1-1'],
  ['fabioskomori', '2-1 4-1 3-1 3-1 4-0 1-1 3-2 3-0 1-0 3-0 4-0 1-1 3-0 2-1 2-1 3-0'],
  ['Favato', '0-1 2-0 2-1 1-0 2-0 0-1 1-0 2-0 2-0 1-0 3-1 1-0 3-0 2-0 0-0 3-0'],
  ['flaviobp', '1-3 3-1 3-1 3-1 3-1 1-1 1-1 3-1 2-1 2-1 3-1 2-1 3-0 2-1 1-1 3-1'],
  ['GabrielMoraes', '2-0 3-0 3-1 2-0 3-0 1-2 1-0 1-0 3-1 0-0 2-0 2-0 3-1 1-0 0-1 3-0'],
  ['joao_ivonaldo', '0-2 1-0 2-2 3-2 4-1 2-2 2-0 2-1 2-1 1-2 3-1 1-1 2-1 2-2 1-1 2-1'],
  ['Leandro01', '2-3 3-1 2-1 2-1 3-1 1-2 2-1 3-0 3-2 3-1 3-0 2-0 4-0 3-1 1-1 4-0'],
  ['lfregnani', '1-2 2-0 2-1 2-0 3-1 1-1 1-1 3-0 2-1 1-1 2-0 2-1 3-0 2-1 1-2 2-0'],
  ['lsergioa', '1-4 3-2 3-2 2-1 2-0 2-1 3-2 5-1 3-2 2-3 2-0 2-1 5-0 2-0 2-1 3-0'],
  ['marcior', '1-3 4-1 3-1 3-1 4-2 1-3 2-1 2-0 2-0 2-1 2-0 2-1 3-0 2-0 1-1 3-1'],
  ['Marga', '1-1 2-0 2-1 2-1 3-1 1-1 3-2 3-0 3-1 0-1 2-0 1-0 4-0 1-1 2-1 2-0'],
  ['marinohc', '0-2 2-0 2-1 2-1 4-1 1-2 1-0 3-2 2-1 1-0 3-1 3-2 3-0 2-0 0-1 3-0'],
  ['mcesar', '1-2 2-1 2-2 2-1 3-1 0-2 2-0 2-0 3-1 2-1 2-0 1-1 3-0 2-0 0-0 2-0'],
  ['mjardim', '0-2 3-0 2-2 3-1 4-1 0-2 2-0 2-1 2-1 2-1 3-0 2-0 0-0 2-0 0-1 -'],
  ['mrportof', '- 2-0 2-1 1-0 2-0 1-1 1-0 3-1 1-0 1-1 1-0 2-2 2-0 2-1 1-2 2-0'],
  ['Osvaldo', '2-1 3-1 2-1 2-1 2-0 2-3 2-0 2-1 2-1 3-2 2-0 2-1 4-0 2-1 2-1 3-1'],
  ['renatothx', '0-1 2-0 1-0 1-0 2-0 0-1 1-1 2-1 2-1 1-2 2-0 2-1 3-1 1-0 1-0 2-0'],
  ['rodrigogirckus', '1-2 2-0 1-0 2-1 3-0 1-3 1-2 2-0 1-0 2-1 2-0 1-0 4-0 3-1 1-1 3-0'],
  ['Ruigrao', '1-2 1-3 3-1 3-1 3-1 2-2 1-1 3-0 2-1 2-1 3-1 2-1 4-0 2-1 1-2 2-0'],
  ['rupcic', '- 1-1 1-2 3-2 4-0 0-1 1-0 2-0 0-1 2-1 3-0 1-1 2-1 2-1 1-1 1-0'],
  ['SergioP', '2-1 3-0 2-2 2-0 3-0 2-2 1-2 3-0 0-1 1-2 2-0 1-0 3-0 1-1 0-1 2-1'],
  ['simasgabriel', '0-1 2-0 1-2 2-0 3-1 1-2 1-0 1-1 1-1 1-1 2-0 1-0 3-0 1-1 0-1 2-0'],
  ['taniaafs', '0-1 4-1 3-2 2-1 4-2 2-2 2-0 2-0 1-2 2-2 3-0 1-2 2-0 3-2 1-2 1-0'],
  ['TizuruMaria', '0-2 2-0 2-0 2-1 3-0 1-2 2-0 2-1 0-2 1-2 1-1 2-2 3-0 1-0 0-1 1-0'],
  ['vagmachado', '1-2 2-0 2-1 2-1 2-1 1-2 2-1 2-1 2-1 2-1 2-0 1-0 3-0 2-1 1-2 3-0'],
  ['victor', '0-3 3-0 3-2 2-0 3-1 1-2 2-0 2-0 1-1 2-2 3-1 2-0 4-0 2-1 2-0 3-0'],
  ['ydirickson', '- 4-1 2-1 2-0 3-0 0-3 2-1 3-2 2-0 1-1 4-0 2-1 5-0 2-1 0-0 2-0'],
];

function usernameKey(value) {
  return String(value).trim().toLowerCase();
}

function parseScore(value) {
  if (value === '-') return null;
  const match = value.match(/^(\d+)-(\d+)$/);
  if (!match) throw new Error(`Placar invalido: ${value}`);
  return { homeGoals: Number(match[1]), awayGoals: Number(match[2]) };
}

function predictionKey(prediction) {
  return `${prediction.poolId}:${prediction.userId}:${prediction.matchId}`;
}

await store.load();

const summary = await store.transaction((db) => {
  const now = new Date().toISOString();
  const pool = db.pools.find((candidate) => candidate.id === POOL_ID || candidate.isActive);
  if (!pool) throw new Error(`Bolao ${POOL_ID} nao encontrado`);

  const teamsById = new Map(db.teams.map((team) => [team.id, team]));
  const usersByUsername = new Map(db.users
    .filter((user) => user.username)
    .map((user) => [usernameKey(user.username), user]));
  const matchesByPair = new Map(db.matches.map((match) => {
    const home = teamsById.get(match.homeTeamId);
    const away = teamsById.get(match.awayTeamId);
    return home && away ? [`${home.code}-${away.code}`, match] : null;
  }).filter(Boolean));

  const prepared = [];
  const missingUsers = new Set();
  const missingMatches = new Set();

  for (const [username, scoreLine] of rows) {
    const user = usersByUsername.get(usernameKey(username));
    if (!user) missingUsers.add(username);

    const scores = scoreLine.split(/\s+/);
    if (scores.length !== matchOrder.length) {
      throw new Error(`${username} tem ${scores.length} palpites; esperado ${matchOrder.length}`);
    }

    scores.forEach((scoreValue, index) => {
      const score = parseScore(scoreValue);
      if (!score) return;
      const pair = matchOrder[index];
      const match = matchesByPair.get(pair);
      if (!match) missingMatches.add(pair);
      prepared.push({ username, user, pair, match, ...score });
    });
  }

  if (missingUsers.size || missingMatches.size) {
    return {
      dryRun,
      store: store.kind,
      valid: false,
      rows: prepared.length,
      missingUsers: [...missingUsers],
      missingMatches: [...missingMatches],
    };
  }

  const duplicates = new Map();
  for (const row of prepared) {
    const key = `${row.user.id}:${row.match.id}`;
    duplicates.set(key, (duplicates.get(key) ?? 0) + 1);
  }
  const duplicateKeys = [...duplicates.entries()].filter(([, count]) => count > 1);
  if (duplicateKeys.length > 0) {
    throw new Error(`Arquivo contem ${duplicateKeys.length} apostas duplicadas para o mesmo usuario/jogo`);
  }

  const existingByKey = new Map(db.predictions.map((prediction) => [predictionKey(prediction), prediction]));
  let created = 0;
  let updated = 0;

  for (const row of prepared) {
    const key = `${pool.id}:${row.user.id}:${row.match.id}`;
    const existing = existingByKey.get(key);

    if (existing) {
      updated++;
      if (!dryRun) {
        existing.homeGoals = row.homeGoals;
        existing.awayGoals = row.awayGoals;
        existing.updatedAt = now;
      }
      continue;
    }

    created++;
    if (!dryRun) {
      db.predictions.push({
        id: newId('pred'),
        poolId: pool.id,
        userId: row.user.id,
        matchId: row.match.id,
        homeGoals: row.homeGoals,
        awayGoals: row.awayGoals,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const byUser = {};
  const byMatch = {};
  for (const row of prepared) {
    byUser[row.username] = (byUser[row.username] ?? 0) + 1;
    byMatch[row.pair] = (byMatch[row.pair] ?? 0) + 1;
  }

  return {
    dryRun,
    store: store.kind,
    valid: true,
    poolId: pool.id,
    rows: prepared.length,
    users: Object.keys(byUser).length,
    matches: Object.keys(byMatch).length,
    created,
    updated,
    byUser,
    byMatch,
  };
});

console.log(JSON.stringify(summary, null, 2));
