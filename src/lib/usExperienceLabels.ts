/**
 * Single source of truth for human-readable labels of the us_client_experience
 * enum. Includes both new (Phase 2B) and legacy values during the migration
 * window so older candidate rows still render until backfill completes.
 */
export const US_EXPERIENCE_LABELS: Record<string, string> = {
  less_than_6_months: "Less than 6 months of US client experience",
  "6_months_to_1_year": "6 months to 1 year of US client experience",
  "1_to_2_years": "1 to 2 years of US client experience",
  "2_to_5_years": "2 to 5 years of US client experience",
  "5_plus_years": "5+ years of US client experience",
  international_only: "Has worked with international (non-US) clients only",
  none: "No prior international client experience",
  // Legacy values
  full_time: "Full-time US client experience",
  part_time_contract: "Part-time / contract US client experience",
};

export const US_EXPERIENCE_VALUES_WITH_US = new Set<string>([
  "full_time",
  "part_time_contract",
  "less_than_6_months",
  "6_months_to_1_year",
  "1_to_2_years",
  "2_to_5_years",
  "5_plus_years",
]);

export function describeUsExperience(value: string | null | undefined): string {
  if (!value) return "Not provided";
  return US_EXPERIENCE_LABELS[value] || value;
}

export function hasUsExperience(value: string | null | undefined): boolean {
  return value ? US_EXPERIENCE_VALUES_WITH_US.has(value) : false;
}
