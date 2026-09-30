/** Tunable linkage weights. Name parts should sum to 1. */
export const MATCH_WEIGHTS = {
  autoLinkThreshold: 0.85,
  reviewThreshold: 0.6,
  name: {
    jaroWinkler: 0.5,
    dice: 0.3,
    levenshtein: 0.2,
  },
  birthYearExact: 0.2,
  birthYearNear: 0.1,
  birthYearMismatch: -0.3,
  locationMatch: 0.1,
  blockPrefixLength: 3,
  candidateLimit: 200,
} as const;

export type MatchWeights = typeof MATCH_WEIGHTS;
