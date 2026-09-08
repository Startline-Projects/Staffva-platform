/**
 * The candidate-facing mirror of how CLIENT SEARCH orders profiles.
 *
 * Deliberately separate from profileCompleteness.ts, which is a different
 * thing: that file is the builder's checklist (named sections, required vs
 * optional, where to go and fix each). This file is the browse ORDERING, and
 * the two must not be merged — a candidate can be "done" by the builder's
 * checklist and still rank low, because the two ask different questions.
 *
 * ⚠️ THE WEIGHTS BELOW MUST MATCH
 * `supabase/migrations/00219_browse_completeness_sort.sql`.
 * The SQL is authoritative — it is what actually orders client search. This
 * exists so the dashboard can tell a candidate why they sit where they sit,
 * and a nudge that disagrees with the ranking is worse than no nudge.
 * Change one, change both, and note it in the migration.
 *
 * The two rules the SQL applies, in order:
 *   1. Profiles WITH a photo sort above profiles without one. Photo is its
 *      own sort key, not merely the heaviest term — a card with no face on
 *      it cannot lead the page however full the rest of it is.
 *   2. Within each group, higher completeness first.
 */

export interface RankingInput {
  profile_photo_url?: string | null;
  video_intro_status?: string | null;
  video_intro_url?: string | null;
  voice_recording_1_url?: string | null;
  bio?: string | null;
  tagline?: string | null;
  skills?: unknown;
  tools?: unknown;
  work_experience?: unknown;
  resume_url?: string | null;
}

export interface RankingItem {
  key: string;
  /** What the candidate sees. Plain, second person, no jargon. */
  label: string;
  points: number;
  done: boolean;
}

function len(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

/** Every scored item, ordered by what it is worth. */
export function rankingItems(c: RankingInput): RankingItem[] {
  return [
    { key: "photo", label: "A profile photo", points: 30, done: !!c.profile_photo_url },
    {
      key: "video",
      label: "A video introduction",
      points: 15,
      // Mirrors the SQL: an unapproved or missing video scores nothing.
      done: c.video_intro_status === "approved" && !!c.video_intro_url,
    },
    {
      key: "bio",
      label: "An About section (80 characters or more)",
      points: 12,
      done: !!c.bio && c.bio.trim().length >= 80,
    },
    { key: "voice", label: "A voice recording", points: 10, done: !!c.voice_recording_1_url },
    { key: "skills", label: "At least 3 skills", points: 10, done: len(c.skills) >= 3 },
    { key: "work", label: "At least one past role", points: 8, done: len(c.work_experience) >= 1 },
    { key: "tagline", label: "A headline", points: 5, done: !!c.tagline && c.tagline.trim() !== "" },
    { key: "tools", label: "At least one tool", points: 5, done: len(c.tools) >= 1 },
    { key: "resume", label: "A résumé", points: 5, done: !!c.resume_url },
  ];
}

/** 0-100. Same arithmetic as the SQL, so the number a candidate is shown is
 *  the number they are actually ranked on. */
export function rankingScore(c: RankingInput): number {
  return rankingItems(c).reduce((n, i) => n + (i.done ? i.points : 0), 0);
}

export function missingForRanking(c: RankingInput): RankingItem[] {
  return rankingItems(c).filter((i) => !i.done);
}
