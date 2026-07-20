import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { store } from './store.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function buildCompetitionSeed(data, createdAt = new Date().toISOString()) {
  assert(data && typeof data === 'object', 'Arquivo de competição inválido');
  assert(Array.isArray(data.teams) && data.teams.length > 0, 'Informe ao menos um time em teams');
  assert(Array.isArray(data.matches) && data.matches.length > 0, 'Informe ao menos um jogo em matches');

  const teams = data.teams.map((team, index) => {
    const code = String(team.code ?? '').trim().toUpperCase();
    const name = String(team.name ?? '').trim();
    assert(code, `Time ${index + 1} sem code`);
    assert(name, `Time ${index + 1} sem name`);
    return {
      ...team,
      id: team.id ?? `team_${code}`,
      name,
      code,
      group: team.group ?? null,
    };
  });

  const teamCodes = new Set(teams.map((team) => team.code));
  assert(teamCodes.size === teams.length, 'Existem códigos de time duplicados');
  const teamsByCode = new Map(teams.map((team) => [team.code, team]));

  const matches = data.matches.map((match, index) => {
    const matchNumber = Number(match.matchNumber);
    assert(Number.isInteger(matchNumber) && matchNumber > 0, `Jogo ${index + 1} sem matchNumber válido`);
    assert(!Number.isNaN(Date.parse(match.startsAt)), `Jogo ${matchNumber} sem startsAt válido`);

    const home = match.homeCode ? teamsByCode.get(String(match.homeCode).toUpperCase()) : null;
    const away = match.awayCode ? teamsByCode.get(String(match.awayCode).toUpperCase()) : null;
    assert(!match.homeCode || home, `Jogo ${matchNumber}: homeCode não encontrado`);
    assert(!match.awayCode || away, `Jogo ${matchNumber}: awayCode não encontrado`);
    assert(!home || !away || home.id !== away.id, `Jogo ${matchNumber}: times iguais`);

    return {
      id: match.id ?? `match_${matchNumber}`,
      matchNumber,
      homeTeamId: home?.id ?? null,
      awayTeamId: away?.id ?? null,
      homeSlot: match.homeSlot ?? home?.name ?? null,
      awaySlot: match.awaySlot ?? away?.name ?? null,
      stage: match.stage ?? 'group',
      group: match.group ?? null,
      startsAt: new Date(match.startsAt).toISOString(),
      lockAt: new Date(match.lockAt ?? match.startsAt).toISOString(),
      venue: match.venue ?? null,
      city: match.city ?? null,
      status: match.status ?? 'scheduled',
      homeGoals: Number.isInteger(match.homeGoals) ? match.homeGoals : null,
      awayGoals: Number.isInteger(match.awayGoals) ? match.awayGoals : null,
      createdAt: match.createdAt ?? createdAt,
    };
  });

  assert(new Set(matches.map((match) => match.id)).size === matches.length, 'Existem IDs de jogo duplicados');
  assert(new Set(matches.map((match) => match.matchNumber)).size === matches.length, 'Existem números de jogo duplicados');

  return { teams, matches };
}

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args.find((arg) => !arg.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const replace = args.includes('--replace');

  if (!inputPath) {
    throw new Error('Uso: node src/seed.js <competition.json> (--dry-run | --replace)');
  }
  if (!dryRun && !replace) {
    throw new Error('Use --dry-run para validar ou --replace para substituir os dados da competição');
  }

  const absolutePath = path.resolve(inputPath);
  const seed = buildCompetitionSeed(JSON.parse(fs.readFileSync(absolutePath, 'utf8')));

  if (!dryRun) {
    await store.load();
    await store.transaction((db) => {
      db.teams = seed.teams;
      db.matches = seed.matches;
      db.predictions = [];
      db.standings = [];
    });
  }

  console.log(JSON.stringify({
    dryRun,
    store: dryRun ? null : store.kind,
    file: absolutePath,
    teams: seed.teams.length,
    matches: seed.matches.length,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
