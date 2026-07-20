import path from 'node:path';
import nextEnv from '@next/env';

if (process.env.NODE_ENV !== 'test') {
  nextEnv.loadEnvConfig(process.cwd());
}

function optionalEnv(name, fallback) {
  return process.env[name]?.trim() || fallback;
}

const currentYear = new Date().getUTCFullYear();

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataStore: process.env.DATA_STORE ?? 'json',
  dataFile: process.env.DATA_FILE ?? path.join(process.cwd(), 'data', 'db.json'),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? '',
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
  firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') ?? '',
  firebaseRootPath: process.env.FIREBASE_ROOT_PATH ?? 'bolao',
  firestoreDatabaseId: process.env.FIRESTORE_DATABASE_ID ?? '(default)',
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '',
  firebaseWebApiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  firebaseWebAuthDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  firebaseWebProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  firebaseWebAppId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  footballDataApiToken: process.env.FOOTBALL_DATA_API_TOKEN ?? '',
  footballDataBaseUrl: process.env.FOOTBALL_DATA_BASE_URL ?? 'https://api.football-data.org/v4',
  liveScoreProvider: optionalEnv('LIVE_SCORE_PROVIDER', 'api-football').toLowerCase(),
  liveScoreCompetitionCode: optionalEnv('LIVE_SCORE_COMPETITION_CODE', ''),
  liveScoreSeason: Number(process.env.LIVE_SCORE_SEASON ?? currentYear),
  livescoreFixturesUrl: optionalEnv('LIVESCORE_FIXTURES_URL', ''),
  livescoreResultsUrl: optionalEnv('LIVESCORE_RESULTS_URL', ''),
  livescoreStandingsUrl: optionalEnv('LIVESCORE_STANDINGS_URL', ''),
  livescorePublicApiUrl: optionalEnv('LIVESCORE_PUBLIC_API_URL', 'https://prod-cdn-public-api.livescore.com'),
  livescoreCompetitionId: optionalEnv('LIVESCORE_COMPETITION_ID', ''),
  competitionId: optionalEnv('COMPETITION_ID', 'current'),
  defaultPoolId: optionalEnv('DEFAULT_POOL_ID', 'pool_main'),
  defaultPoolName: optionalEnv('DEFAULT_POOL_NAME', 'Bolao Principal'),
  defaultPoolInviteCode: optionalEnv('DEFAULT_POOL_INVITE_CODE', 'BOLAO'),
  // API-Football (api-sports.io)
  apiFootballKey: process.env.API_FOOTBALL_KEY ?? '',
  apiFootballLeagueId: Number(process.env.API_FOOTBALL_LEAGUE_ID ?? 0),
  apiFootballSeason: Number(process.env.API_FOOTBALL_SEASON ?? currentYear),
  apiFootballPlan: (process.env.API_FOOTBALL_PLAN ?? 'free').toLowerCase(),
  apiFootballSyncDailyBudget: Number(process.env.API_FOOTBALL_SYNC_DAILY_BUDGET ?? 60),
  apiFootballSyncSecret: process.env.API_FOOTBALL_SYNC_SECRET ?? '',
};
