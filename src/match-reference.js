export function matchReferenceCandidates(match) {
  const values = [
    match?.id,
    match?.externalMatchId,
    match?.externalId,
    match?.fixtureId,
  ];

  if (match?.matchNumber != null) {
    values.push(String(match.matchNumber), `match_${match.matchNumber}`);
  }

  return new Set(values.filter((value) => value != null && value !== '').map(String));
}

export function findMatchByReference(matches, reference) {
  if (reference == null || reference === '') return null;
  const ref = String(reference);
  return matches.find((match) => matchReferenceCandidates(match).has(ref)) ?? null;
}

export function predictionBelongsToMatch(prediction, match) {
  return matchReferenceCandidates(match).has(String(prediction?.matchId ?? ''));
}

export const PREDICTION_LOCK_LEAD_MS = 5 * 60_000;

export function predictionLockTime(match) {
  const startsAtMs = new Date(match?.startsAt).getTime();
  const lockAtMs = match?.lockAt ? new Date(match.lockAt).getTime() : Number.POSITIVE_INFINITY;
  const fiveMinutesBeforeStart = Number.isNaN(startsAtMs)
    ? Number.POSITIVE_INFINITY
    : startsAtMs - PREDICTION_LOCK_LEAD_MS;

  return Math.min(lockAtMs, fiveMinutesBeforeStart);
}

export function isPredictionOpen(match, nowMs = Date.now()) {
  return predictionLockTime(match) > nowMs;
}

export function hasMatchTeamsDefined(match) {
  return Boolean(match?.homeTeamId && match?.awayTeamId);
}
