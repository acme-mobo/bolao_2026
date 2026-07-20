import fs from 'node:fs';
import { newId } from './id.js';
import { store } from './store.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const poolArgIndex = args.indexOf('--pool');
const poolId = poolArgIndex >= 0 ? args[poolArgIndex + 1] : null;
const positionalArgs = args.filter((arg, index) => (
  !arg.startsWith('--') && index !== poolArgIndex + 1
));
const inputPath = positionalArgs[0];

if (!inputPath) {
  throw new Error('Uso: node src/import-pasted-predictions.js <arquivo.md> [--pool <id>] [--dry-run]');
}

function normalize(value) {
  return String(value)
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ç/g, 'c')
    .replace(/Ç/g, 'C')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseTable(raw) {
  const rows = [];

  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim() || /^\|\s*-+/.test(line) || /^\|\s*username\s*\|/i.test(line)) continue;

    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 2) {
      throw new Error(`Linha ${index + 1} invalida: ${line}`);
    }

    const [username, aposta] = cells;
    const match = aposta.match(/^(.+?)\s+(\d+)\s+x\s+(\d+)\s+(.+)$/i);
    if (!match) {
      throw new Error(`Aposta invalida na linha ${index + 1}: ${aposta}`);
    }

    rows.push({
      line: index + 1,
      username,
      homeName: match[1].trim(),
      homeGoals: Number(match[2]),
      awayGoals: Number(match[3]),
      awayName: match[4].trim(),
    });
  }

  return rows;
}

function buildTeamResolver(teams) {
  const byName = new Map();

  for (const team of teams) {
    byName.set(normalize(team.name), team);
    byName.set(normalize(team.code), team);
  }

  return (name) => byName.get(normalize(name));
}

function predictionKey(prediction) {
  return `${prediction.poolId}:${prediction.userId}:${prediction.matchId}`;
}

await store.load();

const raw = fs.readFileSync(inputPath, 'utf8');
const rows = parseTable(raw);

const summary = await store.transaction((db) => {
  const now = new Date().toISOString();
  const pool = poolId
    ? db.pools.find((candidate) => candidate.id === poolId)
    : db.pools.find((candidate) => candidate.isActive) ?? db.pools[0];
  if (!pool) throw new Error(poolId ? `Bolao ${poolId} nao encontrado` : 'Nenhum bolao encontrado');

  const resolveTeam = buildTeamResolver(db.teams);
  const usersByUsername = new Map(
    db.users
      .filter((user) => user.username)
      .map((user) => [normalize(user.username), user]),
  );
  const matchesByTeams = new Map(db.matches.map((match) => (
    [`${match.homeTeamId}:${match.awayTeamId}`, match]
  )));

  const prepared = rows.map((row) => {
    const user = usersByUsername.get(normalize(row.username));
    const home = resolveTeam(row.homeName);
    const away = resolveTeam(row.awayName);
    const match = home && away ? matchesByTeams.get(`${home.id}:${away.id}`) : null;

    return { ...row, user, home, away, match };
  });

  const missingUsers = [...new Set(prepared.filter((row) => !row.user).map((row) => row.username))];
  const missingTeams = [...new Set(prepared.flatMap((row) => [
    row.home ? null : row.homeName,
    row.away ? null : row.awayName,
  ]).filter(Boolean))];
  const missingMatches = prepared
    .filter((row) => row.home && row.away && !row.match)
    .map((row) => `${row.homeName} x ${row.awayName} (linha ${row.line})`);

  if (missingUsers.length || missingTeams.length || missingMatches.length) {
    return {
      dryRun,
      store: store.kind,
      rows: rows.length,
      valid: false,
      missingUsers,
      missingTeams,
      missingMatches,
    };
  }

  const duplicates = new Map();
  for (const row of prepared) {
    const key = `${row.user.id}:${row.match.id}`;
    duplicates.set(key, (duplicates.get(key) ?? 0) + 1);
  }
  const duplicateCount = [...duplicates.values()].filter((count) => count > 1).length;
  if (duplicateCount > 0) {
    throw new Error(`Arquivo contem ${duplicateCount} apostas duplicadas para o mesmo usuario/jogo`);
  }

  const existingByKey = new Map(db.predictions.map((prediction) => [predictionKey(prediction), prediction]));
  let created = 0;
  let updated = 0;

  if (!dryRun) {
    for (const row of prepared) {
      const key = `${pool.id}:${row.user.id}:${row.match.id}`;
      const existing = existingByKey.get(key);

      if (existing) {
        existing.homeGoals = row.homeGoals;
        existing.awayGoals = row.awayGoals;
        existing.updatedAt = now;
        updated++;
        continue;
      }

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
      created++;
    }
  } else {
    for (const row of prepared) {
      const key = `${pool.id}:${row.user.id}:${row.match.id}`;
      if (existingByKey.has(key)) updated++;
      else created++;
    }
  }

  const byUser = {};
  for (const row of prepared) {
    byUser[row.username] = (byUser[row.username] ?? 0) + 1;
  }

  return {
    dryRun,
    store: store.kind,
    valid: true,
    poolId: pool.id,
    rows: rows.length,
    users: Object.keys(byUser).length,
    matches: new Set(prepared.map((row) => row.match.id)).size,
    created,
    updated,
    byUser,
  };
});

console.log(JSON.stringify(summary, null, 2));
