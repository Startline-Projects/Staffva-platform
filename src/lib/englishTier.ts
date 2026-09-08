/**
 * The English tier scale, in one place.
 *
 * The enum is exceptional | proficient | competent (00001). /api/match was
 * scoring "advanced" and "professional" — values the grader has never
 * written and the type cannot hold — so two of its three tier bonuses were
 * dead branches and only the top tier ever scored. /api/jobs had the right
 * names with different weights, which is how the drift went unnoticed.
 *
 * Weights still differ per surface (matching is worth more in an AI search
 * than in job-post scoring), so callers pass their own; only the NAMES are
 * shared, because those are the part that can be wrong.
 */
export type EnglishTier = "exceptional" | "proficient" | "competent";

export const ENGLISH_TIERS: readonly EnglishTier[] = [
  "exceptional",
  "proficient",
  "competent",
] as const;

/**
 * Points for a candidate's written English tier.
 * @param weights [exceptional, proficient, competent]
 */
export function englishTierBonus(
  tier: string | null | undefined,
  weights: [number, number, number]
): number {
  const i = ENGLISH_TIERS.indexOf(tier as EnglishTier);
  return i === -1 ? 0 : weights[i];
}
