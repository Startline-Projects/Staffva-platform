/**
 * Shared approval checks for candidate profiles.
 *
 * ── 2026-09-08: ASSESSMENTS ARE NO LONGER A GATE (owner's model change) ──
 * A candidate now goes live on a complete PROFILE. The English test and the
 * AI interview became optional: they raise a candidate's ranking and tell
 * them where to improve, and the Vetted badge (shipped 2026-09-07) is what
 * distinguishes those who took them. Three conditions were removed here:
 *   - english_mc_score >= 70
 *   - english_comprehension_score >= 70
 *   - interview_consent_at present — consent to an OPTIONAL activity cannot
 *     be a precondition for using the platform; it is still collected in the
 *     profile builder, and the interview flow takes its own consent before
 *     it records anything.
 * The skills-interview precondition below went with them.
 *
 * What remains is exactly "is this profile fit to show a client".
 * ⚠️ The database enforces its own copy of these rules — see migration 00221.
 * Changing one without the other makes the app and the database disagree
 * about who may go live.
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

interface GateCandidate {
  voice_recording_1_url: string | null;
  voice_recording_2_url: string | null;
  id_verification_status: string | null;
  profile_photo_url: string | null;
  resume_url: string | null;
  tagline: string | null;
  bio: string | null;
  payout_method: string | null;
}

export function checkApprovalGates(candidate: GateCandidate): {
  pass: boolean;
  failingConditions: string[];
} {
  const failingConditions: string[] = [];

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

  return { pass: failingConditions.length === 0, failingConditions };
}

/**
 * There are no longer any asynchronous approval preconditions.
 *
 * checkApprovalPreconditions() lived here and required a completed, passed
 * `kind='skills'` interview before ANY route could approve. It was deleted
 * with the model change above rather than left returning true, so that no
 * caller believes a gate is running when it is not. If a future precondition
 * needs a database round trip, it belongs here beside the pure gates — that
 * co-location is why this module exists (the manager route once shipped
 * without half the checks).
 */
