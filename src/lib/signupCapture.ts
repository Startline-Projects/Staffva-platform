import { BROWSE_PILLS } from "./roleTaxonomy";

/**
 * The signup-capture vocabularies, shared by the signup pages and
 * /api/ensure-profile so they cannot drift. The role categories derive from
 * roleTaxonomy's BROWSE_PILLS — the ONE browse vocabulary — because
 * clients.hiring_for exists to prefill /browse?role=, and a hand-copied list
 * is exactly how the "VA pill matched zero rows" bug happened.
 *
 * The DB-side copies (the CHECK constraints and handle_new_user's allowlist
 * in migration 00232) are necessarily frozen SQL literals: change anything
 * here and ship a migration updating them in the same commit.
 */
export const SIGNUP_ROLE_CATEGORIES: string[] = [
  ...BROWSE_PILLS.map((p) => p.label),
  "Other",
];

export const CLIENT_REFERRAL_SOURCES: { value: string; label: string }[] = [
  { value: "google", label: "Google search" },
  { value: "social", label: "Social media" },
  { value: "referral", label: "Referred by someone" },
  { value: "press", label: "Press or article" },
  { value: "podcast", label: "Podcast" },
  { value: "newsletter", label: "Newsletter" },
  { value: "event", label: "Event or conference" },
  { value: "other", label: "Other" },
];

/** Sanitize the hiring-for chips from an untrusted payload: known values
 * only, deduplicated, capped at the size of the vocabulary itself. */
export function sanitizeHiringFor(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set(SIGNUP_ROLE_CATEGORIES);
  return [...new Set(input.filter((c): c is string => typeof c === "string" && allowed.has(c)))]
    .slice(0, SIGNUP_ROLE_CATEGORIES.length);
}
