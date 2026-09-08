/**
 * The English tier scale, in one place.
 *
 * FIVE names exist in this column, not three. 00001 created
 * exceptional | proficient | competent; 00029_badge_renames then added
 * 'advanced' and 'professional' to the enum AND ran
 *   UPDATE candidates SET english_written_tier='advanced'     WHERE ...='proficient'
 *   UPDATE candidates SET english_written_tier='professional' WHERE ...='competent'
 * with nothing since reverting it. Meanwhile assignWrittenTier() in
 * gradeAttempt.ts writes the ORIGINAL three, so a freshly graded row and a
 * legacy row use different words for the same level. /candidate/[id] still
 * labels the legacy pair, which is how they were known to still be live.
 *
 * This file previously asserted that 'advanced' and 'professional' were
 * "values the enum cannot hold" and scored them 0. They are held, and the
 * cost was that every legacy candidate scored nothing for English on four
 * surfaces — browse ordering, /api/match, job-post matching, and the
 * per-criterion breakdown — while their own profile page displayed a real
 * tier. The aliases are recognised now.
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

/** Legacy 00029 spellings → the canonical tier at the same level. */
const TIER_ALIASES: Record<string, EnglishTier> = {
  advanced: "proficient",
  professional: "competent",
};

/** Display names, covering both vocabularies. */
const TIER_LABELS: Record<EnglishTier, string> = {
  exceptional: "Exceptional",
  proficient: "Proficient",
  competent: "Competent",
};

/** The canonical tier for any spelling in the column; null if unset or unknown. */
export function canonicalTier(tier: string | null | undefined): EnglishTier | null {
  if (!tier) return null;
  if ((ENGLISH_TIERS as readonly string[]).includes(tier)) return tier as EnglishTier;
  return TIER_ALIASES[tier] ?? null;
}

/** Title-cased tier name, or null when there is no tier to name. */
export function englishTierLabel(tier: string | null | undefined): string | null {
  const canon = canonicalTier(tier);
  return canon ? TIER_LABELS[canon] : null;
}

/**
 * Points for a candidate's written English tier.
 * @param weights [exceptional, proficient, competent]
 */
export function englishTierBonus(
  tier: string | null | undefined,
  weights: [number, number, number]
): number {
  const canon = canonicalTier(tier);
  if (!canon) return 0;
  return weights[ENGLISH_TIERS.indexOf(canon)];
}
