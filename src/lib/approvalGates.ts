/**
 * Shared 10-gate approval check for candidate profiles.
 * Used by both recruiter/approve and recruiting-manager/approve endpoints.
 */

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
  if (candidate.id_verification_status !== "passed") {
    failingConditions.push("ID verification not passed");
  }
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
