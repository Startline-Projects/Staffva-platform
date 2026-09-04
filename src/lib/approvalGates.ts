/**
 * Shared approval checks for candidate profiles.
 *
 * Used by both recruiter/approve and recruiting-manager/approve. The ten
 * profile-completeness gates below were already shared; the interview
 * preconditions were not, and only the recruiter route had them. So the
 * manager route would approve a candidate who had never passed the AI
 * interview — it even selected second_interview_status and then never looked
 * at it.
 *
 * Measured before fixing: 48 candidates passed all ten gates and 23 of them
 * had never passed the AI interview. 41 were approvable through the manager
 * route at that moment and refused by the recruiter route.
 *
 * Every check lives here, so the next route that approves a candidate cannot
 * pick up one half and miss the other. The second-interview precondition was
 * one of them until the second interview was removed entirely; see
 * checkApprovalPreconditions below for why.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

interface GateCandidate {
  english_mc_score: number | null;
  english_comprehension_score: number | null;
  voice_recording_1_url: string | null;
  voice_recording_2_url: string | null;
  id_verification_status: string | null;
  profile_photo_url: string | null;
  resume_url: string | null;
  tagline: string | null;
  bio: string | null;
  payout_method: string | null;
  interview_consent_at: string | null;
}

export function checkApprovalGates(candidate: GateCandidate): {
  pass: boolean;
  failingConditions: string[];
} {
  const failingConditions: string[] = [];

  if (candidate.english_mc_score == null || candidate.english_mc_score < 70) {
    failingConditions.push("English grammar score below passing threshold");
  }
  if (candidate.english_comprehension_score == null || candidate.english_comprehension_score < 70) {
    failingConditions.push("English comprehension score below passing threshold");
  }
  if (!candidate.voice_recording_1_url) {
    failingConditions.push("Oral reading recording missing");
  }
  if (!candidate.voice_recording_2_url) {
    failingConditions.push("Self-introduction recording missing");
  }
  // ID verification is deliberately NOT a gate (owner's call, 2026-09-03):
  // candidates get a 14-day window AFTER assessments to verify, and an
  // overdue unverified profile is hidden from clients by the read-side
  // predicate (00154) rather than blocked from approval.
  if (!candidate.profile_photo_url) {
    failingConditions.push("Profile photo missing");
  }
  if (!candidate.resume_url) {
    failingConditions.push("Resume missing");
  }
  if (!candidate.tagline) {
    failingConditions.push("Tagline missing");
  }
  if (!candidate.bio) {
    failingConditions.push("Bio missing");
  }
  if (!candidate.payout_method) {
    failingConditions.push("Payout method not selected");
  }
  if (!candidate.interview_consent_at) {
    failingConditions.push("Interview consent not confirmed");
  }

  return { pass: failingConditions.length === 0, failingConditions };
}

/**
 * The two interview preconditions that must hold before ANY approval.
 *
 * Separate from checkApprovalGates because these need a database round trip
 * while the gates are pure. Kept in the same module so they are found together.
 */
export async function checkApprovalPreconditions(
  supabase: SupabaseClient,
  candidate: { id: string }
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  // THE SECOND INTERVIEW REQUIREMENT IS GONE.
  //
  // This used to require second_interview_status === 'completed'. That step was
  // a human recruiter on a call, which does not survive contact with thousands
  // of candidates — StaffVA is a marketplace, not a staffing agency, and the
  // pipeline has to run without a person in it.
  //
  // The signal did not disappear, it moved: the AI interview is now the only
  // interview and asks 10 questions, or 12 for specialised roles, with explicit
  // instructions to probe experience claims for evidence, test accountability,
  // and check what the candidate says against what they claimed on their
  // application. See staffva-interview-main, lib/interviewDepth.
  //
  // The profile gates are untouched, so approval still requires both voice
  // recordings, a photo, a resume and the rest. (ID verification moved to a
  // post-assessment 14-day window — see checkApprovalGates.)
  // THE KIND FILTER MATTERS (step 9). The interview split gave
  // ai_interviews a `kind`: 'behavioral' (Interview 1) and 'skills'
  // (Interview 2, the exam this gate has always meant). Without the filter,
  // passing the short behavioral round would satisfy the gate that exists
  // to prove someone can do the work — approval on half the vetting.
  // Pre-split rows default to 'skills', so history reads correctly.
  const { data: aiInterview, error } = await supabase
    .from("ai_interviews")
    .select("id")
    .eq("candidate_id", candidate.id)
    .eq("kind", "skills")
    .eq("status", "completed")
    .eq("passed", true)
    .limit(1)
    .maybeSingle();

  // Fail CLOSED. This decides whether an unvetted profile goes live to clients,
  // so an unreachable check must block rather than wave the approval through.
  if (error) {
    return {
      ok: false,
      status: 503,
      error: "Could not verify the AI interview result. Please try again.",
    };
  }

  if (!aiInterview) {
    return { ok: false, status: 400, error: "Skills interview not passed" };
  }

  return { ok: true };
}
