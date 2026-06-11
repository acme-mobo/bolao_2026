import { config } from './config.js';
import { HttpError } from './errors.js';
import { worldCup2026Teams } from './world-cup-2026-data.js';

const NEXT_DATA_RE = /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>(.*?)<\/script>/s;
const BUILD_ID_RE = /"buildId"\s*:\s*"([^"]+)"/;

const LIVE_STATUSES = new Set(['LIVE', 'IN_PLAY', 'PLAYING', 'HT', 'PAUSED']);
const FINISHED_STATUSES = new Set(['FINISHED', 'ENDED', 'FT', 'AFTER_PEN', 'AFTER_EXTRA_TIME']);
const CANCELLED_STATUSES = new Set(['CANCELLED', 'CANCELED', 'ABANDONED', 'SUSPENDED']);
const POSTPONED_STATUSES = new Set(['POSTPONED', 'DELAYED']);
const DATE_API_LIVE_STATUSES = new Set([2, 3, 4, 5]);
const DATE_API_FINISHED_STATUSES = new Set([6, 7, 8, 9]);

const livescoreCodeOverrides = new Map([
  ['CZECHIA', 'CZE'],
  ['SOUTH AFRICA', 'RSA'],
  ['SOUTH KOREA', 'KOR'],
  ['BOSNIA AND HERZEGOVINA', 'BIH'],
  ['BRAZIL', 'BRA'],
  ['MOROCCO', 'MAR'],
  ['SCOTLAND', 'SCO'],
  ['USA', 'USA'],
  ['UNITED STATES', 'USA'],
  ['TURKIYE', 'TUR'],
  ['TURKEY', 'TUR'],
  ['GERMANY', 'GER'],
  ['CURACAO', 'CUW'],
  ['IVORY COAST', 'CIV'],
  ['NETHERLANDS', 'NED'],
  ['JAPAN', 'JPN'],
  ['BELGIUM', 'BEL'],
  ['EGYPT', 'EGY'],
  ['IRAN', 'IRN'],
  ['NEW ZEALAND', 'NZL'],
  ['CAPE VERDE', 'CPV'],
  ['SAUDI ARABIA', 'KSA'],
  ['FRANCE', 'FRA'],
  ['IRAQ', 'IRQ'],
  ['ALGERIA', 'ALG'],
  ['JORDAN', 'JOR'],
  ['DR CONGO', 'COD'],
  ['DEMOCRATIC REPUBLIC OF THE CONGO', 'COD'],
  ['ENGLAND', 'ENG'],
]);

const localCodeByName = new Map(
  worldCup2026Teams.map(([name, code]) => [normalizeNameKey(name), code]),
);

function parseScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeNameKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function codeForTeam(team) {
  const candidates = [team.NmEn, team.Tnm].map(normalizeNameKey).filter(Boolean);
  for (const candidate of candidates) {
    if (livescoreCodeOverrides.has(candidate)) return livescoreCodeOverrides.get(candidate);
    if (localCodeByName.has(candidate)) return localCodeByName.get(candidate);
  }
  return null;
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseLiveScoreDate(value) {
  if (!/^\d{14}$/.test(String(value ?? ''))) return null;
  const text = String(value);
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6)) - 1;
  const day = Number(text.slice(6, 8));
  const hour = Number(text.slice(8, 10));
  const minute = Number(text.slice(10, 12));
  const second = Number(text.slice(12, 14));
  return new Date(Date.UTC(year, month, day, hour, minute, second)).toISOString();
}

function normalizeStatus(event) {
  const eventStatus = String(event.eventStatus ?? '').toUpperCase();
  const statusDescription = String(event.statusDescription ?? '').toUpperCase();
  const status = String(event.status ?? '').toUpperCase();
  const statusCandidates = [eventStatus, statusDescription, status].filter(Boolean);
  const details = event.scores?.matchStatusDetails ?? {};

  if (details.isFinished || statusCandidates.some((candidate) => FINISHED_STATUSES.has(candidate))) return 'finished';
  if (details.isInProgress || statusCandidates.some((candidate) => LIVE_STATUSES.has(candidate))) return 'live';
  if (statusCandidates.some((candidate) => CANCELLED_STATUSES.has(candidate))) return 'cancelled';
  if (statusCandidates.some((candidate) => POSTPONED_STATUSES.has(candidate))) return 'scheduled';
  return 'scheduled';
}

function normalizeDateApiStatus(event) {
  const statusId = Number(event.Esid);
  const statusText = String(event.Eps ?? '').toUpperCase();

  if (DATE_API_FINISHED_STATUSES.has(statusId) || ['FT', 'AET', 'AP', 'PEN'].includes(statusText)) return 'finished';
  if (DATE_API_LIVE_STATUSES.has(statusId) || statusText.includes("'") || event.Etm?.RTm) return 'live';
  if (['POSTP', 'PST', 'CAN', 'ABD', 'SUSP'].includes(statusText)) return statusText === 'CAN' ? 'cancelled' : 'scheduled';
  return 'scheduled';
}

function extractGroup(stageName) {
  return stageName?.replace(/^Group\s+/i, '').trim() || null;
}

export function normalizeLiveScoreEvent(event) {
  const score = event.scores ?? {};
  const homeGoals = parseScore(event.homeTeamScore ?? score.homeTeamScore);
  const awayGoals = parseScore(event.awayTeamScore ?? score.awayTeamScore);

  return {
    externalId: String(event.id),
    fixtureId: String(event.id),
    date: parseLiveScoreDate(event.startDateTimeString),
    statusShort: event.eventStatus ?? null,
    statusElapsed: null,
    status: normalizeStatus(event),
    round: null,
    group: extractGroup(event.stageName),
    venue: null,
    city: null,
    homeCode: event.homeTeamAbr ?? null,
    awayCode: event.awayTeamAbr ?? null,
    homeName: event.homeTeamNameEn ?? event.homeTeamName ?? '',
    awayName: event.awayTeamNameEn ?? event.awayTeamName ?? '',
    homeLogo: event.homeTeamBadge ?? event.homeTeamImgSlug ?? null,
    awayLogo: event.awayTeamBadge ?? event.awayTeamImgSlug ?? null,
    homeGoals,
    awayGoals,
    rawStatus: event.eventStatus ?? null,
    updatedAt: new Date().toISOString(),
  };
}

function firstTeam(teamList) {
  return Array.isArray(teamList) ? teamList[0] ?? {} : {};
}

export function normalizeLiveScoreDateEvent(event, stage = {}) {
  const homeTeam = firstTeam(event.T1);
  const awayTeam = firstTeam(event.T2);
  const homeGoals = parseScore(event.Tr1 ?? event.Trh1);
  const awayGoals = parseScore(event.Tr2 ?? event.Trh2);
  const status = normalizeDateApiStatus(event);

  return {
    externalId: String(event.Eid),
    fixtureId: String(event.Eid),
    date: parseLiveScoreDate(event.Esd),
    statusShort: event.Eps ?? null,
    statusElapsed: event.Etm?.RTm ?? null,
    status,
    round: null,
    group: extractGroup(stage.Snm ?? stage.Sdn),
    venue: null,
    city: null,
    homeCode: homeTeam.Abr ?? codeForTeam(homeTeam) ?? null,
    awayCode: awayTeam.Abr ?? codeForTeam(awayTeam) ?? null,
    homeName: homeTeam.NmEn ?? homeTeam.Nm ?? homeTeam.Tnm ?? '',
    awayName: awayTeam.NmEn ?? awayTeam.Nm ?? awayTeam.Tnm ?? '',
    homeLogo: homeTeam.Img ?? null,
    awayLogo: awayTeam.Img ?? null,
    homeGoals,
    awayGoals,
    rawStatus: event.Eps ?? event.Esid ?? null,
    updatedAt: new Date().toISOString(),
  };
}

function collectEvents(payload) {
  return (payload?.pageProps?.initialData?.sections ?? [])
    .flatMap((section) => section.events ?? []);
}

function collectDateKeys(events) {
  return [...new Set(
    events
      .map((event) => String(event?.startDateTimeString ?? '').slice(0, 8))
      .filter((value) => /^\d{8}$/.test(value)),
  )];
}

function collectDateApiFixtures(payload, competitionId) {
  return (payload?.Stages ?? [])
    .filter((stage) => !competitionId || String(stage.CompId) === String(competitionId))
    .flatMap((stage) => (stage.Events ?? []).map((event) => normalizeLiveScoreDateEvent(event, stage)));
}

function extractNextData(html) {
  const match = html.match(NEXT_DATA_RE);
  if (!match) return null;
  return JSON.parse(match[1]);
}

function extractBuildId(html, payload) {
  if (payload?.buildId) return payload.buildId;
  const match = html.match(BUILD_ID_RE);
  return match?.[1] ?? null;
}

function buildNextDataUrl(fixturesUrl, buildId) {
  const sourceUrl = new URL(fixturesUrl);
  const parts = sourceUrl.pathname.split('/').filter(Boolean);
  const [, sport, dateOrCategory, competitionOrStage] = parts;
  const jsonPath = `/_next/data/${buildId}/${parts.join('/')}.json`;
  const jsonUrl = new URL(jsonPath, sourceUrl.origin);

  if (sport) jsonUrl.searchParams.set('sport', sport);
  if (dateOrCategory) jsonUrl.searchParams.set('dateOrCategory', dateOrCategory);
  if (competitionOrStage) jsonUrl.searchParams.set('competitionOrStage', competitionOrStage);

  return jsonUrl;
}

function pageUrlFor(baseUrl, tab) {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/(fixtures|results|standings)\/?$/, `/${tab}/`);
  return url.toString();
}

export function normalizeLiveScoreStandings(payload) {
  return (payload?.Stages ?? []).flatMap((stage) => {
    const group = extractGroup(stage.Snm ?? stage.Sdn);
    const tables = stage.LeagueTable?.L?.flatMap((leagueTable) => leagueTable.Tables ?? []) ?? [];
    return tables.flatMap((table) => (table.team ?? []).map((team) => ({
      group,
      rank: parseNumber(team.rnk),
      teamId: team.Tid ?? null,
      teamCode: codeForTeam(team),
      teamName: team.Tnm ?? team.NmEn ?? '',
      teamNameEn: team.NmEn ?? null,
      teamLogo: team.Img ?? null,
      points: parseNumber(team.pts ?? team.ptsn),
      played: parseNumber(team.pld),
      won: parseNumber(team.win),
      drawn: parseNumber(team.drw),
      lost: parseNumber(team.lst),
      goalsFor: parseNumber(team.gf),
      goalsAgainst: parseNumber(team.ga),
      goalsDiff: parseNumber(team.gd),
      form: null,
      source: 'livescore',
      stageId: stage.Sid ?? null,
    })));
  });
}

export class LiveScoreClient {
  constructor(options = {}) {
    this.fixturesUrl = options.fixturesUrl ?? config.livescoreFixturesUrl;
    this.resultsUrl = options.resultsUrl ?? config.livescoreResultsUrl;
    this.standingsUrl = options.standingsUrl ?? config.livescoreStandingsUrl;
    this.publicApiUrl = options.publicApiUrl ?? config.livescorePublicApiUrl;
    this.competitionId = options.competitionId ?? config.livescoreCompetitionId;
    this.locale = options.locale ?? 'pt';
    this.requestCount = 0;
  }

  get configured() {
    return Boolean(this.fixturesUrl);
  }

  async fetchPayload(url = this.fixturesUrl) {
    if (!url) throw new HttpError(503, 'URL LiveScore nao configurada');

    const htmlResponse = await fetch(url, { headers: { accept: 'text/html' } });
    this.requestCount++;

    if (!htmlResponse.ok) {
      throw new HttpError(htmlResponse.status, 'Falha ao consultar LiveScore', await htmlResponse.text());
    }

    const html = await htmlResponse.text();
    const fallbackPayload = extractNextData(html);
    const buildId = extractBuildId(html, fallbackPayload);
    if (!buildId) return fallbackPayload;

    const jsonUrl = buildNextDataUrl(url, buildId);
    try {
      const jsonResponse = await fetch(jsonUrl, { headers: { accept: 'application/json' } });
      this.requestCount++;
      if (!jsonResponse.ok) return fallbackPayload;
      return await jsonResponse.json();
    } catch {
      return fallbackPayload;
    }
  }

  async fetchLiveFixtures() {
    const payload = await this.fetchPayload();
    if (!payload) throw new Error('LiveScore nao retornou dados de fixtures');
    const events = collectEvents(payload);

    try {
      const resultsPayload = await this.fetchPayload(pageUrlFor(this.resultsUrl || this.fixturesUrl, 'results'));
      events.push(...collectEvents(resultsPayload));
    } catch {
      // Fixtures alone are enough for scheduled/live games; results are a best-effort enrichment.
    }

    const byId = new Map(events.filter((event) => event?.id).map((event) => [String(event.id), normalizeLiveScoreEvent(event)]));

    for (const dateKey of collectDateKeys(events)) {
      try {
        const dateFixtures = await this.fetchDateFixtures(dateKey);
        for (const fixture of dateFixtures) {
          if (byId.has(fixture.externalId)) byId.set(fixture.externalId, fixture);
        }
      } catch {
        // The public date API is an enrichment for live score freshness; Next data remains the fallback.
      }
    }

    return [...byId.values()];
  }

  async fetchDateFixtures(dateKey) {
    if (!this.publicApiUrl) return [];
    const url = new URL(`/v1/api/app/date/soccer/${dateKey}/0`, this.publicApiUrl);
    url.searchParams.set('locale', this.locale);

    const response = await fetch(url, { headers: { accept: 'application/json' } });
    this.requestCount++;
    if (!response.ok) {
      throw new HttpError(response.status, 'Falha ao consultar data LiveScore', await response.text());
    }

    return collectDateApiFixtures(await response.json(), this.competitionId);
  }

  async fetchResultFixtures() {
    const payload = await this.fetchPayload(pageUrlFor(this.resultsUrl || this.fixturesUrl, 'results'));
    if (!payload) throw new Error('LiveScore nao retornou dados de resultados');
    return collectEvents(payload).map(normalizeLiveScoreEvent);
  }

  async fetchStandings() {
    if (!this.publicApiUrl) throw new HttpError(503, 'LIVESCORE_PUBLIC_API_URL nao configurado');
    const pagePayload = await this.fetchPayload(pageUrlFor(this.standingsUrl || this.fixturesUrl, 'standings'));
    const competitionId = pagePayload?.pageProps?.competitionId ?? this.competitionId;
    if (!competitionId) throw new Error('LiveScore nao retornou competitionId para standings');

    const url = new URL(`/v1/api/app/competition/${competitionId}/leagueTable`, this.publicApiUrl);
    url.searchParams.set('locale', this.locale);

    const response = await fetch(url, { headers: { accept: 'application/json' } });
    this.requestCount++;
    if (!response.ok) {
      throw new HttpError(response.status, 'Falha ao consultar tabela LiveScore', await response.text());
    }

    return normalizeLiveScoreStandings(await response.json());
  }
}
