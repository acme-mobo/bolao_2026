export function matchOutcome(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return 'home';
  if (awayGoals > homeGoals) return 'away';
  return 'draw';
}

export function scorePrediction(match, prediction) {
  if (!Number.isInteger(match.homeGoals) || !Number.isInteger(match.awayGoals)) {
    return 0;
  }

  const exact =
    prediction.homeGoals === match.homeGoals && prediction.awayGoals === match.awayGoals;
  if (exact) return 25;

  const points = [];
  const predictedOutcome = matchOutcome(prediction.homeGoals, prediction.awayGoals);
  const actualOutcome = matchOutcome(match.homeGoals, match.awayGoals);
  if (predictedOutcome === actualOutcome) points.push(10);

  const predictedDiff = prediction.homeGoals - prediction.awayGoals;
  const actualDiff = match.homeGoals - match.awayGoals;
  if (predictedDiff === actualDiff) points.push(5);

  if (prediction.homeGoals === match.homeGoals) points.push(2);
  if (prediction.awayGoals === match.awayGoals) points.push(2);

  return points.reduce((total, point) => total + point, 0);
}

export function buildLeaderboard(db, poolId) {
  const members = db.memberships.filter((membership) => membership.poolId === poolId);
  return members
    .map((membership) => {
      const user = db.users.find((candidate) => candidate.id === membership.userId);
      const predictions = db.predictions.filter(
        (prediction) => prediction.poolId === poolId && prediction.userId === membership.userId,
      );
      const points = predictions.reduce((total, prediction) => {
        const match = db.matches.find((candidate) => candidate.id === prediction.matchId);
        return total + (match ? scorePrediction(match, prediction) : 0);
      }, 0);

      return {
        userId: membership.userId,
        name: user?.name ?? 'Usuario removido',
        predictions: predictions.length,
        points,
      };
    })
    .sort((a, b) => b.points - a.points || b.predictions - a.predictions || a.name.localeCompare(b.name));
}
