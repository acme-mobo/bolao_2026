import path from 'node:path';
import nextEnv from '@next/env';

if (process.env.NODE_ENV !== 'test') {
  nextEnv.loadEnvConfig(process.cwd());
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataStore: process.env.DATA_STORE ?? 'json',
  dataFile: process.env.DATA_FILE ?? path.join(process.cwd(), 'data', 'db.json'),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? '',
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
  firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') ?? '',
  firebaseRootPath: process.env.FIREBASE_ROOT_PATH ?? 'bolao26',
  firestoreDatabaseId: process.env.FIRESTORE_DATABASE_ID ?? '(default)',
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '',
  firebaseWebApiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  firebaseWebAuthDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  firebaseWebProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  firebaseWebAppId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  footballDataApiToken: process.env.FOOTBALL_DATA_API_TOKEN ?? '',
  footballDataBaseUrl: process.env.FOOTBALL_DATA_BASE_URL ?? 'https://api.football-data.org/v4',
  liveScoreCompetitionCode: process.env.LIVE_SCORE_COMPETITION_CODE ?? 'WC',
  liveScoreSeason: Number(process.env.LIVE_SCORE_SEASON ?? 2026),
  // API-Football (api-sports.io)
  apiFootballKey: process.env.API_FOOTBALL_KEY ?? '',
  apiFootballLeagueId: Number(process.env.API_FOOTBALL_LEAGUE_ID ?? 1),
  apiFootballSeason: Number(process.env.API_FOOTBALL_SEASON ?? 2026),
  apiFootballPlan: (process.env.API_FOOTBALL_PLAN ?? 'free').toLowerCase(),
  apiFootballSyncSecret: process.env.API_FOOTBALL_SYNC_SECRET ?? '',
};
