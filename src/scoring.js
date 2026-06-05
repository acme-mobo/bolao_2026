export function matchOutcome(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return 'home';
  if (awayGoals > homeGoals) return 'away';
  return 'draw';
}

export function scorePrediction(match, prediction) {
  if (!Number.isInteger(match.homeGoals) || !Number.isInteger(match.awayGoals)) return 0;

  const mH = match.homeGoals, mA = match.awayGoals;
  const pH = prediction.homeGoals, pA = prediction.awayGoals;

  // 25 pts — placar exato (vitória ou empate)
  if (pH === mH && pA === mA) return 25;

  const outcome     = matchOutcome(mH, mA);
  const predOutcome = matchOutcome(pH, pA);
  if (predOutcome !== outcome) return 0;

  // Empate acertado mas placar errado → 10 pts
  if (outcome === 'draw') return 10;

  // Vitória: avalia saldo e gols individuais
  if ((pH - pA) === (mH - mA)) return 18; // vencedor + saldo de gols
  if (pH === mH || pA === mA)  return 15; // vencedor + gols de um time
  return 10;                               // só o vencedor
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
        const match = db.matches.find((m) => m.id === p.matchId);
        if (!match || !Number.isInteger(match.homeGoals)) continue;
        const pts = scorePrediction(match, p);
        points += pts;
        if (pts === 25) exactCount++;
        if (pts > 0)   correctOutcomeCount++;
      }

      return {
        userId: membership.userId,
        name: user?.name ?? 'Usuario removido',
        predictions: predictions.length,
        points,
        exactCount,
        correctOutcomeCount,
      };
    })
    .sort((a, b) =>
      b.points               - a.points               ||
      b.exactCount           - a.exactCount           ||
      b.correctOutcomeCount  - a.correctOutcomeCount  ||
      a.name.localeCompare(b.name),
    );
}
