import { MATCH_WEIGHTS, MatchWeights } from './match-weights';
import { normalizePersonName } from './normalize-name';
import {
  diceCoefficient,
  jaroWinkler,
  levenshteinSimilarity,
} from './string-similarity';

export type MatchableRecord = {
  extractedName: string | null;
  birthYear: number | null;
  location: string | null;
};

export type MatchableProfile = {
  canonicalName: string | null;
  knownNames: string[];
  resolvedBirthYear: number | null;
  resolvedLocation: string | null;
};

export type MatchScore = {
  confidence: number;
  name: number;
  birthYear: number;
  location: number;
};

export function calculateMatchScore(
  rawRecord: MatchableRecord,
  masterProfile: MatchableProfile,
  weights: MatchWeights = MATCH_WEIGHTS,
): MatchScore {
  const name = nameScore(rawRecord.extractedName, masterProfile, weights);
  const birthYear = birthYearAdjustment(
    rawRecord.birthYear,
    masterProfile.resolvedBirthYear,
    weights,
  );
  const location = locationsMatch(rawRecord.location, masterProfile.resolvedLocation)
    ? weights.locationMatch
    : 0;

  return {
    confidence: clamp(name + birthYear + location),
    name,
    birthYear,
    location,
  };
}

export function nameScore(
  extractedName: string | null,
  masterProfile: MatchableProfile,
  weights: MatchWeights = MATCH_WEIGHTS,
): number {
  const left = normalizePersonName(extractedName);
  const rights = [masterProfile.canonicalName, ...masterProfile.knownNames]
    .map((name) => normalizePersonName(name))
    .filter((name): name is string => Boolean(name));

  if (!left || rights.length === 0) {
    return 0;
  }

  return Math.max(...rights.map((right) => pairNameScore(left, right, weights)));
}

function pairNameScore(left: string, right: string, weights: MatchWeights): number {
  const ordered = blendName(left, right, weights);
  const sorted = blendName(sortTokens(left), sortTokens(right), weights);
  return Math.max(ordered, sorted);
}

function blendName(left: string, right: string, weights: MatchWeights): number {
  const parts = weights.name;
  const weightSum = parts.jaroWinkler + parts.dice + parts.levenshtein;
  if (weightSum === 0) {
    return 0;
  }
  return (
    (jaroWinkler(left, right) * parts.jaroWinkler +
      diceCoefficient(left, right) * parts.dice +
      levenshteinSimilarity(left, right) * parts.levenshtein) /
    weightSum
  );
}

function birthYearAdjustment(
  rawYear: number | null,
  profileYear: number | null,
  weights: MatchWeights,
): number {
  if (rawYear == null || profileYear == null) {
    return 0;
  }
  const gap = Math.abs(rawYear - profileYear);
  if (gap === 0) {
    return weights.birthYearExact;
  }
  if (gap === 1) {
    return weights.birthYearNear;
  }
  return weights.birthYearMismatch;
}

function locationsMatch(left: string | null, right: string | null): boolean {
  const normalizedLeft = normalizePersonName(left);
  const normalizedRight = normalizePersonName(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }

  const leftTokens = new Set(normalizedLeft.split(' '));
  const rightTokens = new Set(normalizedRight.split(' '));
  const [smaller, larger] =
    leftTokens.size <= rightTokens.size
      ? [leftTokens, rightTokens]
      : [rightTokens, leftTokens];
  for (const token of smaller) {
    if (!larger.has(token)) {
      return false;
    }
  }
  return smaller.size > 0;
}

function sortTokens(value: string): string {
  return value.split(' ').sort((left, right) => left.localeCompare(right)).join(' ');
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
