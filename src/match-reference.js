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
