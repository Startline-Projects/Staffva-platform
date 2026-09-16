import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * The admin-facing candidate record.
 *
 * Until now the only per-candidate admin surface was a preview modal inside
 * the review queue, so there was no address you could send someone to and
 * nothing that showed a candidate's whole file at once. This loads that file.
 *
 * `candidates` carries 168 columns. This selects the ones the record renders
 * and nothing else — a `select("*")` here would ship every draft, token and
 * internal flag to the browser for a page that shows a fraction of them.
 *
 * Naming a column that does not exist makes PostgREST reject the whole select,
 * so the loader returns null and the record 404s. That is what the reputation
 * columns did after they were dropped — an explicit list is safer than
 * `select("*")` but it has to be kept in step with the schema.
 *
 * Server-only: reads SUPABASE_SERVICE_ROLE_KEY. Do not import from a
 * "use client" module.
 */

const CANDIDATE_FIELDS = `
  id, user_id, created_at, updated_at,
  full_name, first_name, last_name, display_name, email, country, city, time_zone,
  linkedin_url, profile_photo_url, pending_photo_url, photo_pending_review,
  admin_status, application_step, application_stage, stage1_completed_at, stage2_completed_at,
  waiting_since, review_entered_at, profile_completed_at, profile_went_live_at,
  assigned_recruiter, assigned_recruiter_at, assignment_pending_review,
  screening_tag, screening_score, screening_reason, screening_priority,
  english_mc_score, english_comprehension_score, english_percentile, english_written_tier,
  test_started_at, test_completed_at, retake_count, retake_available_at,
  english_attempts_exhausted, permanently_blocked, test_lockout_until,
  cheat_flag_count, score_mismatch_flag, anticheat_strike_count,
  anticheat_lockout_triggered, anticheat_lockout_reason,
  integrity_pledge_accepted, integrity_pledge_accepted_at,
  proctor_consent_at, proctor_consent_version,
  voice_recording_1_url, voice_recording_2_url,
  video_intro_url, video_intro_status, video_intro_submitted_at, video_intro_admin_note,
  ai_interview_badge, ai_interview_score, ai_interview_passed, ai_interview_completed_at,
  interview_consent, interview_consent_at,
  id_verification_status, id_verification_submitted_at, id_verification_reviewed_at,
  id_verification_review_note, id_verification_due_at, id_verification_consent_at,
  bio, tagline, skills, tools, work_experience, education, certifications, languages,
  role_title, role_category, classified_role_category, role_category_custom,
  years_experience, has_college_degree, us_client_experience, resume_url,
  ai_insight_1, ai_insight_2,
  hourly_rate, committed_hours, hours_per_week, working_hours,
  availability_status, availability_date, needs_availability_update,
  computer_specs, has_headset, has_webcam,
  payout_method, payout_status, payout_currency, total_earnings_usd,
  stripe_onboarding_complete, activation_fee_paid,
  ban_pending_review, ban_requested_by, ban_requested_at, ban_reason,
  rejection_reason, rejected_at, reapply_eligible_at,
  appeal_text, appeal_submitted_at, appeal_decision,
  admin_revision_note, admin_revision_sent_at, recruiter_notes
`;

export interface StatusEvent {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  actorRole: string | null;
  actorName: string | null;
  reason: string | null;
  createdAt: string;
}

export interface CandidateRecord {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: Record<string, any>;
  recruiter: { id: string; fullName: string | null; email: string } | null;
  events: StatusEvent[];
  /** True only when the events table has a row for this candidate. */
  hasHistory: boolean;
  /**
   * How many candidates on the whole platform have an English score. An empty
   * assessment section means something very different depending on this: the
   * page can say "this person has not sat it" or "nobody has a score right
   * now", and only one of those is about the candidate you are looking at.
   */
  platform: { total: number; withEnglishScore: number };
  engagements: { id: string; status: string; createdAt: string }[];
  aiInterviews: { id: string; kind: string | null; status: string | null; createdAt: string }[];
  specialists: { id: string; fullName: string | null }[];
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function loadCandidateRecord(id: string): Promise<CandidateRecord | null> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  if (!user || (role !== "admin" && role !== "recruiting_manager")) return null;

  const db = serviceClient();

  const { data: c, error } = await db
    .from("candidates")
    .select(CANDIDATE_FIELDS)
    .eq("id", id)
    .maybeSingle();

  if (error || !c) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cand = c as Record<string, any>;

  const [eventsRes, engRes, aiRes, specialistsRes, totalRes, englishRes] = await Promise.all([
    db
      .from("candidate_status_events")
      .select("id, from_status, to_status, actor_id, actor_role, reason, created_at")
      .eq("candidate_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    db.from("engagements").select("id, status, created_at").eq("candidate_id", id).order("created_at", { ascending: false }),
    db.from("ai_interviews").select("id, kind, status, created_at").eq("candidate_id", id).order("created_at", { ascending: false }),
    db.from("profiles").select("id, full_name").in("role", ["recruiter", "recruiting_manager"]).order("full_name"),
    db.from("candidates").select("id", { count: "exact", head: true }),
    db.from("candidates").select("id", { count: "exact", head: true }).not("english_mc_score", "is", null),
  ]);

  // Names for whoever appears in the history or holds the assignment. Every
  // one of the 445 rows on this table today has a null actor — the column is
  // written by the current review code but nothing backfilled the rows that
  // predate it, so most history reads as "system".
  const actorIds = new Set<string>();
  for (const e of eventsRes.data ?? []) if (e.actor_id) actorIds.add(e.actor_id);
  if (cand.assigned_recruiter) actorIds.add(cand.assigned_recruiter);

  const names = new Map<string, { fullName: string | null; email: string }>();
  if (actorIds.size > 0) {
    const { data: people } = await db
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [...actorIds]);
    for (const p of people ?? []) names.set(p.id, { fullName: p.full_name, email: p.email });
  }

  const recruiterInfo = cand.assigned_recruiter ? names.get(cand.assigned_recruiter) : null;

  return {
    c: cand,
    recruiter: cand.assigned_recruiter && recruiterInfo
      ? { id: cand.assigned_recruiter, fullName: recruiterInfo.fullName, email: recruiterInfo.email }
      : null,
    events: (eventsRes.data ?? []).map((e) => ({
      id: e.id,
      fromStatus: e.from_status,
      toStatus: e.to_status,
      actorRole: e.actor_role,
      actorName: e.actor_id ? (names.get(e.actor_id)?.fullName ?? null) : null,
      reason: e.reason,
      createdAt: e.created_at,
    })),
    hasHistory: (eventsRes.data?.length ?? 0) > 0,
    engagements: (engRes.data ?? []).map((e) => ({ id: e.id, status: e.status, createdAt: e.created_at })),
    aiInterviews: (aiRes.data ?? []).map((a) => ({ id: a.id, kind: a.kind, status: a.status, createdAt: a.created_at })),
    specialists: (specialistsRes.data ?? []).map((p) => ({ id: p.id, fullName: p.full_name })),
    platform: { total: totalRes.count ?? 0, withEnglishScore: englishRes.count ?? 0 },
  };
}
