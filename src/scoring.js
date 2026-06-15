import { findMatchByReference } from './match-reference.js';

export const EXACT_SCORE_POINTS = 5;
export const CORRECT_OUTCOME_POINTS = 3;

export function hasMatchResult(match) {
  return Number.isInteger(match.homeGoals) && Number.isInteger(match.awayGoals);
}

export function matchOutcome(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return 'home';
  if (awayGoals > homeGoals) return 'away';
  return 'draw';
}

export function isExactScore(match, prediction) {
  return hasMatchResult(match)
    && prediction.homeGoals === match.homeGoals
    && prediction.awayGoals === match.awayGoals;
}

export function scorePrediction(match, prediction) {
  if (!hasMatchResult(match)) return 0;

  const mH = match.homeGoals, mA = match.awayGoals;
  const pH = prediction.homeGoals, pA = prediction.awayGoals;

  if (isExactScore(match, prediction)) return EXACT_SCORE_POINTS;

  const outcome     = matchOutcome(mH, mA);
  const predOutcome = matchOutcome(pH, pA);
  return predOutcome === outcome ? CORRECT_OUTCOME_POINTS : 0;
}

export function buildLeaderboard(db, poolId) {
  const members = db.memberships.filter((m) => m.poolId === poolId);
  return members
    .map((membership) => {
      const user = db.users.find((u) => u.id === membership.userId);
      const predictions = db.predictions.filter(
        (p) => p.poolId === poolId && p.userId === membership.userId,
      );

      let points = 0, exactCount = 0, correctOutcomeCount = 0;
      for (const p of predictions) {
        const match = findMatchByReference(db.matches, p.matchId);
        if (!match || !hasMatchResult(match)) continue;
        const pts = scorePrediction(match, p);
        points += pts;
        if (isExactScore(match, p)) exactCount++;
        if (pts > 0)   correctOutcomeCount++;
      }

      return {
        userId: membership.userId,
        name: user?.name ?? 'Usuario removido',
        username: user?.username ?? null,
        predictions: predictions.length,
        points,
        exactCount,
        correctOutcomeCount,
      };
    })
    .sort((a, b) =>
      b.points               - a.points               ||
      b.exactCount           - a.exactCount           ||
      a.name.localeCompare(b.name),
    );
}
