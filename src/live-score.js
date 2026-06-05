import { config } from './config.js';
import { HttpError } from './errors.js';

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
  }

  getStatus() {
    return {
      provider: 'football-data.org',
      configured: Boolean(this.token),
      competitionCode: this.competitionCode,
      season: this.season,
    };
  }

  async fetchMatches() {
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

    if (!response.ok) {
      throw new HttpError(response.status, 'Falha ao consultar football-data.org', await response.text());
    }

    const payload = await response.json();
    return (payload.matches ?? []).map((match) => {
      const score = normalizeScore(match);
      return {
        externalId: String(match.id),
        utcDate: match.utcDate,
        status: statusMap[match.status] ?? 'scheduled',
        homeTeamCode: normalizeCode(match.homeTeam),
        awayTeamCode: normalizeCode(match.awayTeam),
        homeTeamName: match.homeTeam?.name ?? '',
        awayTeamName: match.awayTeam?.name ?? '',
        homeGoals: score.home,
        awayGoals: score.away,
        rawStatus: match.status,
        lastUpdated: match.lastUpdated,
      };
    });
  }
}

function sameFixture(localMatch, remoteMatch, teamsById) {
  const home = teamsById.get(localMatch.homeTeamId);
  const away = teamsById.get(localMatch.awayTeamId);
  return home?.code === remoteMatch.homeTeamCode && away?.code === remoteMatch.awayTeamCode;
}

export async function syncLiveScores(db, provider = new FootballDataLiveScoreProvider()) {
  const remoteMatches = await provider.fetchMatches();
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

    localMatch.externalProvider = provider.getStatus().provider;
    localMatch.externalMatchId = remoteMatch.externalId;
    localMatch.externalLastUpdated = remoteMatch.lastUpdated ?? now;
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
    provider: provider.getStatus(),
    fetched: remoteMatches.length,
    updated: changes.length,
    changes,
    syncedAt: now,
  };
}
