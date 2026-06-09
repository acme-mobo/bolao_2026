import { config } from './config.js';
import { HttpError } from './errors.js';
import { ApiFootballClient } from './api-football.js';

const statusMap = {
  SCHEDULED: 'scheduled',
  TIMED: 'scheduled',
  IN_PLAY: 'live',
  PAUSED: 'live',
  FINISHED: 'finished',
  POSTPONED: 'scheduled',
  SUSPENDED: 'cancelled',
  CANCELED: 'cancelled',
  CANCELLED: 'cancelled',
};

function normalizeCode(team) {
  return team?.tla ?? team?.code ?? '';
}

function normalizeScore(match) {
  const fullTime = match.score?.fullTime ?? {};
  const regularTime = match.score?.regularTime ?? {};
  const home = fullTime.home ?? regularTime.home ?? null;
  const away = fullTime.away ?? regularTime.away ?? null;
  return {
    home: Number.isInteger(home) ? home : null,
    away: Number.isInteger(away) ? away : null,
  };
}

export class FootballDataLiveScoreProvider {
  constructor(options = {}) {
    this.token = options.token ?? config.footballDataApiToken;
    this.baseUrl = options.baseUrl ?? config.footballDataBaseUrl;
    this.competitionCode = options.competitionCode ?? config.liveScoreCompetitionCode;
    this.season = options.season ?? config.liveScoreSeason;
    this.requestCount = 0;
    this.quotaBucket = null;
  }

  getStatus() {
    return {
      provider: 'football-data.org',
      configured: Boolean(this.token),
      competitionCode: this.competitionCode,
      season: this.season,
    };
  }

  get configured() {
    return Boolean(this.token);
  }

  async fetchLiveFixtures() {
    if (!this.token) {
      throw new HttpError(503, 'FOOTBALL_DATA_API_TOKEN nao configurado');
    }

    const url = new URL(`${this.baseUrl}/competitions/${this.competitionCode}/matches`);
    url.searchParams.set('season', String(this.season));

    const response = await fetch(url, {
      headers: {
        'X-Auth-Token': this.token,
        accept: 'application/json',
      },
    });
    this.requestCount++;

    if (!response.ok) {
      throw new HttpError(response.status, 'Falha ao consultar football-data.org', await response.text());
    }

    const payload = await response.json();
    return (payload.matches ?? []).map((match) => {
      const score = normalizeScore(match);
      return {
        externalId: String(match.id),
        fixtureId: String(match.id),
        date: match.utcDate,
        statusShort: match.status,
        statusElapsed: null,
        status: statusMap[match.status] ?? 'scheduled',
        round: null,
        group: null,
        venue: null,
        city: null,
        homeCode: normalizeCode(match.homeTeam),
        awayCode: normalizeCode(match.awayTeam),
        homeName: match.homeTeam?.name ?? '',
        awayName: match.awayTeam?.name ?? '',
        homeLogo: null,
        awayLogo: null,
        homeGoals: score.home,
        awayGoals: score.away,
        rawStatus: match.status,
        updatedAt: match.lastUpdated,
      };
    });
  }

  async fetchMatches() {
    return this.fetchLiveFixtures();
  }
}

export class ApiFootballLiveScoreProvider {
  constructor(options = {}) {
    this.client = options.client ?? new ApiFootballClient(options);
    this.quotaBucket = 'api-football';
  }

  get requestCount() {
    return this.client.requestCount;
  }

  get configured() {
    return this.client.configured;
  }

  getStatus() {
    return {
      provider: 'api-football',
      configured: this.configured,
      leagueId: this.client.leagueId,
      season: this.client.season,
      quotaBucket: this.quotaBucket,
    };
  }

  async fetchLiveFixtures() {
    return this.client.fetchLiveFixtures();
  }
}

export function createLiveScoreProvider(options = {}) {
  const provider = options.provider ?? config.liveScoreProvider;
  if (provider === 'api-football') return new ApiFootballLiveScoreProvider(options);
  if (provider === 'football-data') return new FootballDataLiveScoreProvider(options);
  throw new Error(`LIVE_SCORE_PROVIDER invalido: ${provider}`);
}

function sameFixture(localMatch, remoteMatch, teamsById) {
  const home = teamsById.get(localMatch.homeTeamId);
  const away = teamsById.get(localMatch.awayTeamId);
  return home?.code === remoteMatch.homeCode && away?.code === remoteMatch.awayCode;
}

function externalIdFor(remoteMatch) {
  return String(remoteMatch.externalId ?? remoteMatch.fixtureId);
}

function lastUpdatedFor(remoteMatch, fallback) {
  return remoteMatch.lastUpdated ?? remoteMatch.updatedAt ?? fallback;
}

export function applyLiveFixturesToDb(db, remoteMatches, providerStatus) {
  const teamsById = new Map(db.teams.map((team) => [team.id, team]));
  const now = new Date().toISOString();
  const changes = [];

  for (const localMatch of db.matches) {
    const remoteMatch = remoteMatches.find((candidate) => sameFixture(localMatch, candidate, teamsById));
    if (!remoteMatch) continue;

    const before = {
      status: localMatch.status,
      homeGoals: localMatch.homeGoals,
      awayGoals: localMatch.awayGoals,
      externalMatchId: localMatch.externalMatchId,
    };

    localMatch.externalProvider = providerStatus.provider;
    localMatch.externalMatchId = externalIdFor(remoteMatch);
    localMatch.externalLastUpdated = lastUpdatedFor(remoteMatch, now);
    localMatch.status = remoteMatch.status;

    if (remoteMatch.homeGoals !== null && remoteMatch.awayGoals !== null) {
      localMatch.homeGoals = remoteMatch.homeGoals;
      localMatch.awayGoals = remoteMatch.awayGoals;
    }

    const changed =
      before.status !== localMatch.status ||
      before.homeGoals !== localMatch.homeGoals ||
      before.awayGoals !== localMatch.awayGoals ||
      before.externalMatchId !== localMatch.externalMatchId;

    if (changed) {
      changes.push({
        matchId: localMatch.id,
        matchNumber: localMatch.matchNumber,
        externalMatchId: localMatch.externalMatchId,
        before,
        after: {
          status: localMatch.status,
          homeGoals: localMatch.homeGoals,
          awayGoals: localMatch.awayGoals,
        },
      });
    }
  }

  return {
    provider: providerStatus,
    fetched: remoteMatches.length,
    updated: changes.length,
    changes,
    syncedAt: now,
  };
}

export async function syncLiveScores(db, provider = createLiveScoreProvider()) {
  const remoteMatches = await provider.fetchLiveFixtures();
  return applyLiveFixturesToDb(db, remoteMatches, provider.getStatus());
}
