import { config } from './config.js';

const BASE_URL = 'https://v3.football.api-sports.io';

const LIVE_STATUSES    = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);

function normalizeStatus(short) {
  if (LIVE_STATUSES.has(short))    return 'live';
  if (FINISHED_STATUSES.has(short)) return 'finished';
  if (short === 'CANC' || short === 'WO' || short === 'ABD') return 'cancelled';
  return 'scheduled';
}

function extractGroup(raw) {
  return raw?.replace(/^Group\s+/i, '').trim() ?? null;
}

export function normalizeFixture(raw) {
  const { fixture, league, teams, goals } = raw;
  return {
    fixtureId:     fixture.id,
    date:          fixture.date,
    statusShort:   fixture.status.short,
    statusElapsed: fixture.status.elapsed ?? null,
    status:        normalizeStatus(fixture.status.short),
    round:         league.round ?? null,
    group:         extractGroup(league.group),
    venue:         fixture.venue?.name ?? null,
    city:          fixture.venue?.city ?? null,
    homeCode:      teams.home.code ?? null,
    awayCode:      teams.away.code ?? null,
    homeName:      teams.home.name,
    awayName:      teams.away.name,
    homeLogo:      teams.home.logo ?? null,
    awayLogo:      teams.away.logo ?? null,
    homeGoals:     goals.home,
    awayGoals:     goals.away,
    updatedAt:     new Date().toISOString(),
  };
}

export function normalizeStanding(entry) {
  return {
    group:        extractGroup(entry.group),
    rank:         entry.rank,
    teamId:       entry.team.id,
    teamName:     entry.team.name,
    teamLogo:     entry.team.logo ?? null,
    points:       entry.points,
    played:       entry.all.played,
    won:          entry.all.win,
    drawn:        entry.all.draw,
    lost:         entry.all.lose,
    goalsFor:     entry.all.goals.for,
    goalsAgainst: entry.all.goals.against,
    goalsDiff:    entry.goalsDiff,
    form:         entry.form ?? null,
  };
}

export class ApiFootballClient {
  constructor(options = {}) {
    this.apiKey   = options.apiKey   ?? config.apiFootballKey;
    this.leagueId = options.leagueId ?? config.apiFootballLeagueId;
    this.season   = options.season   ?? config.apiFootballSeason;
    this.baseUrl  = options.baseUrl  ?? BASE_URL;
    this.requestCount = 0;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  async _get(path, params = {}) {
    if (!this.apiKey) throw new Error('API_FOOTBALL_KEY não configurado');

    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
    }

    const res = await fetch(url.toString(), {
      headers: { 'x-apisports-key': this.apiKey, accept: 'application/json' },
    });
    this.requestCount++;

    const body = await res.json();

    if (!res.ok) {
      throw new Error(`API-Football HTTP ${res.status}: ${JSON.stringify(body.errors ?? body)}`);
    }
    if (body.errors && Object.keys(body.errors).length > 0) {
      throw new Error(`API-Football error: ${JSON.stringify(body.errors)}`);
    }

    return body;
  }

  // Filtra a liga e a temporada configuradas quando a API retorna outras competições.
  _filterAndNormalize(response) {
    return response
      .filter((r) => r.league.id === this.leagueId && Number(r.league.season) === this.season)
      .map(normalizeFixture);
  }

  // Todos os jogos da competição (para seed inicial)
  async fetchAllFixtures() {
    const json = await this._get('/fixtures', { league: this.leagueId, season: this.season });
    return this._filterAndNormalize(json.response ?? []);
  }

  // Jogos de uma data específica com fallback para plano free
  async fetchDailyFixtures(date) {
    const json = await this._get('/fixtures', { date });
    return this._filterAndNormalize(json.response ?? []);
  }

  // Jogos ao vivo — sem filtro de liga para contornar restrição do plano free
  async fetchLiveFixtures() {
    const json = await this._get('/fixtures', { live: 'all' });
    return this._filterAndNormalize(json.response ?? []);
  }

  // Classificação dos grupos
  async fetchStandings() {
    const json = await this._get('/standings', { league: this.leagueId, season: this.season });
    const leagueData = json.response?.[0]?.league;
    if (!leagueData) return [];
    return (leagueData.standings ?? []).flat().map(normalizeStanding);
  }
}
