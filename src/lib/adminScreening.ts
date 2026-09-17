import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * Whether the screening tags still mean anything.
 *
 * `screening_tag` reads Hold on 247 of 257 candidates, and the panel has been
 * showing that as a queue of flagged people. It is not one. Two separate
 * things produced it and they need separating, because only one of them is
 * fixed by re-running:
 *
 *   · Tags computed BEFORE the candidate filled their profile in. Screening
 *     used to be enqueued at the end of stage 1, against a row holding the
 *     values the form invented — years_experience "0-1", rate 5, no bio, no
 *     skills. The model described an empty form accurately and the tag stuck.
 *     Those reasons still say "no bio, no listed skills" for candidates who
 *     now have ten years of experience and a full profile. The enqueue point
 *     was fixed; the tags were never recomputed.
 *
 *   · Tags computed under the previous rubric, which asked whether each
 *     candidate suited "a U.S. law firm or accounting firm" and held anyone
 *     whose role was "completely unrelated to legal or accounting work".
 *     StaffVA recruits across thirteen role families, so that clause held four
 *     candidates in five for applying to a job the platform advertises.
 *
 * A tag is only evidence about a candidate if it was computed from the record
 * that candidate actually has, under a rubric that describes this business.
 * This module says how many fail that test, so a stale tag reads as stale
 * instead of as a judgment.
 *
 * Server-only: reads SUPABASE_SERVICE_ROLE_KEY.
 */

/**
 * When the corrected rubric took effect. Anything screened before this used
 * the legal/accounting-only rubric and is not comparable with anything after.
 *
 * Move this if the deploy lags the merge — a tag written between the two would
 * otherwise be counted as current when it was produced by the old prompt.
 */
export const RUBRIC_V2_AT = "2026-09-16T00:00:00.000Z";

export interface ScreeningHealth {
  total: number;
  tags: { Priority: number; Review: number; Hold: number; untagged: number };
  /** Candidates with no screening_queue row at all. */
  neverQueued: number;
  /** Screened before the candidate's own data landed — provably describes a record that no longer exists. */
  staleBeforeProfile: number;
  /** Screened under the previous rubric, whatever the record looked like. */
  staleOldRubric: number;
  /** Ids worth re-running: the union of the two above, and only people who can be screened. */
  stale: string[];
  /**
   * Candidates who started an application and never finished stage 2. There
   * is nothing to screen, so they are never stale and never re-queued: the
   * cron would only defer them, and re-queueing all 59 at once is exactly what
   * jammed the queue in simulation.
   */
  unfinishedApplications: number;
  queue: { pending: number; processing: number; rate_limited: number; failed: number; complete: number };
}

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function assertStaff() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  return Boolean(user) && (role === "admin" || role === "recruiting_manager");
}

/** null means a read failed — never "the tags are fine". */
export async function loadScreeningHealth(): Promise<ScreeningHealth | null> {
  if (!(await assertStaff())) return null;
  const db = serviceClient();

  const [candRes, queueRes] = await Promise.all([
    db.from("candidates").select("id, screening_tag, application_stage, stage2_completed_at, profile_completed_at"),
    db.from("screening_queue").select("candidate_id, status, processed_at"),
  ]);
  if (candRes.error || !candRes.data) return null;
  if (queueRes.error || !queueRes.data) return null;

  const tags = { Priority: 0, Review: 0, Hold: 0, untagged: 0 };
  const queue = { pending: 0, processing: 0, rate_limited: 0, failed: 0, complete: 0 };

  const screenedAt = new Map<string, string | null>();
  for (const q of queueRes.data) {
    screenedAt.set(q.candidate_id as string, (q.processed_at as string | null) ?? null);
    const st = q.status as keyof typeof queue;
    if (st in queue) queue[st] += 1;
  }

  const rubricCutoff = Date.parse(RUBRIC_V2_AT);
  let neverQueued = 0;
  let staleBeforeProfile = 0;
  let staleOldRubric = 0;
  let unfinishedApplications = 0;
  const stale: string[] = [];

  for (const c of candRes.data) {
    const tag = c.screening_tag as string | null;
    if (tag === "Priority" || tag === "Review" || tag === "Hold") tags[tag] += 1;
    else tags.untagged += 1;

    const id = c.id as string;

    // Before anything else: a stage-1 record has no data to judge. Counting it
    // as stale would put it in the re-queue, where the cron can only defer it.
    if (((c.application_stage as number | null) ?? 0) < 2) {
      unfinishedApplications += 1;
      continue;
    }

    if (!screenedAt.has(id)) {
      neverQueued += 1;
      continue;
    }
    const at = screenedAt.get(id);
    // Not yet screened is not stale — it is pending, and the queue counts above
    // already say so.
    if (!at) continue;

    const ran = Date.parse(at);
    // The moment the candidate's substantive data landed. Screened before it
    // and the tag describes something the record no longer contains.
    const completedCandidates = [c.stage2_completed_at, c.profile_completed_at]
      .filter((v): v is string => typeof v === "string")
      .map((v) => Date.parse(v));
    const completedAt = completedCandidates.length ? Math.max(...completedCandidates) : null;

    const beforeProfile = completedAt !== null && ran < completedAt;
    const oldRubric = ran < rubricCutoff;

    if (beforeProfile) staleBeforeProfile += 1;
    if (oldRubric) staleOldRubric += 1;
    if (beforeProfile || oldRubric) stale.push(id);
  }

  return {
    total: candRes.data.length,
    tags,
    neverQueued,
    staleBeforeProfile,
    staleOldRubric,
    stale,
    unfinishedApplications,
    queue,
  };
}
