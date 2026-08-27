import { createHmac } from "crypto";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The identity anchor: one verified_identities row per verified PERSON, keyed
 * by identity_hash, holding the Stripe verification session id.
 *
 * This module exists because the anchor was designed but never built. The
 * table had a full consumer ecosystem — the escalating test-lockout ladder,
 * the admin duplicates page, check_identity_lockout — and zero producers:
 * create-session returned Stripe's session id to the browser and discarded
 * it, and the webhook only ever UPDATEd a table nothing had INSERTed into.
 * Result, measured before this shipped: 0 rows, and identity_session_id NULL
 * for all 255 candidates including all 105 marked verified.
 *
 * The proctor depends on this: face-matching a session against the verified
 * selfie requires retrieving the Stripe verification report, which requires
 * having kept the session id.
 */

/**
 * A stable, privacy-preserving key for "this human", derived from the
 * verified outputs of a Stripe Identity session.
 *
 * Keyed HMAC, not a bare hash: the inputs (name, birth date, document number)
 * are low-entropy enough to brute-force from a leaked digest, so the digest
 * is useless without the server-side key. Uses IDENTITY_HASH_KEY when set,
 * else falls back to SUPABASE_JWT_SECRET so the feature works without a new
 * deployment variable; set the dedicated key at the next convenient deploy.
 *
 * The prefix records what the hash was computed FROM, because rows of
 * different provenance must not be compared as if they were equal:
 *   doc:     document id number + surname — the strongest dedup signal
 *   pii:     full name + date of birth — good, but collides on twins/namesakes
 *            in principle; fine as a review trigger, not as auto-judgment
 *   session: nothing usable was available — unique per session, so it anchors
 *            the session id but has NO dedup power. Never treat a session:
 *            row as proof of uniqueness.
 */
export function computeIdentityHash(
  verifiedOutputs: Stripe.Identity.VerificationSession.VerifiedOutputs | null | undefined,
  sessionId: string
): string {
  const key = process.env.IDENTITY_HASH_KEY || process.env.SUPABASE_JWT_SECRET;
  if (!key) return "session:" + sessionId;

  const norm = (v: string | null | undefined) => (v || "").trim().toLowerCase();
  const last = norm(verifiedOutputs?.last_name);
  const first = norm(verifiedOutputs?.first_name);
  const dob = verifiedOutputs?.dob
    ? `${verifiedOutputs.dob.year}-${verifiedOutputs.dob.month}-${verifiedOutputs.dob.day}`
    : "";
  const idNumber = norm(verifiedOutputs?.id_number);

  let prefix: string;
  let material: string;
  if (idNumber) {
    prefix = "doc:";
    material = `id|${idNumber}|${last}`;
  } else if (first && last && dob) {
    prefix = "pii:";
    material = `pii|${first}|${last}|${dob}`;
  } else {
    return "session:" + sessionId;
  }

  return prefix + createHmac("sha256", key).update(material).digest("hex");
}

export type AnchorOutcome =
  | { outcome: "anchored"; identityHash: string }
  | { outcome: "duplicate"; identityHash: string; originalCandidateId: string | null }
  | { outcome: "error"; message: string };

/**
 * Record a verified session for a candidate: store the session id on their
 * row, and upsert the verified_identities record. Detects the case the old
 * (never-executed) code could not: the same PERSON verifying on a second
 * account. Two accounts produce two different session ids, so session-id
 * matching never finds them; the identity hash does.
 *
 * On a duplicate the single row (identity_hash is UNIQUE) is updated to the
 * shape the admin duplicates page expects: candidate_id = the new account,
 * duplicate_of_candidate_id = the original, flagged for review. Nothing is
 * blocked automatically — flagging for a person to review is the whole
 * pattern this platform is converging on.
 */
export async function recordVerifiedIdentity(opts: {
  supabase: SupabaseClient;
  stripe: Stripe;
  candidateId: string;
  sessionId: string;
}): Promise<AnchorOutcome> {
  const { supabase, stripe, candidateId, sessionId } = opts;

  // Always anchor the session id on the candidate, even if everything after
  // this fails — it is the retrieval key for the verification report.
  const { error: anchorError } = await supabase
    .from("candidates")
    .update({ identity_session_id: sessionId })
    .eq("id", candidateId);
  if (anchorError) {
    return { outcome: "error", message: `could not store session id: ${anchorError.message}` };
  }

  // Fetch the verified outputs. dob and id_number are sensitive fields that
  // only arrive when expanded; if the expansion is refused (older API
  // settings), retry plain and fall back to whatever is available.
  let session: Stripe.Identity.VerificationSession | null = null;
  try {
    session = await stripe.identity.verificationSessions.retrieve(sessionId, {
      expand: ["verified_outputs.dob", "verified_outputs.id_number"],
    });
  } catch {
    try {
      session = await stripe.identity.verificationSessions.retrieve(sessionId);
    } catch (err) {
      return {
        outcome: "error",
        message: `could not retrieve session: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }
  }

  const identityHash = computeIdentityHash(session?.verified_outputs, sessionId);

  const { data: existing, error: lookupError } = await supabase
    .from("verified_identities")
    .select("id, candidate_id")
    .eq("identity_hash", identityHash)
    .maybeSingle();
  if (lookupError) {
    return { outcome: "error", message: `identity lookup failed: ${lookupError.message}` };
  }

  if (!existing) {
    const { error } = await supabase.from("verified_identities").insert({
      identity_hash: identityHash,
      stripe_verification_session_id: sessionId,
      candidate_id: candidateId,
    });
    if (error) return { outcome: "error", message: `insert failed: ${error.message}` };
    return { outcome: "anchored", identityHash };
  }

  if (existing.candidate_id === candidateId) {
    // Same person re-verifying on the same account (a retry): keep the newest
    // session id, nothing suspicious.
    const { error } = await supabase
      .from("verified_identities")
      .update({ stripe_verification_session_id: sessionId })
      .eq("id", existing.id);
    if (error) return { outcome: "error", message: `refresh failed: ${error.message}` };
    return { outcome: "anchored", identityHash };
  }

  // Same identity document, different account.
  const { error } = await supabase
    .from("verified_identities")
    .update({
      candidate_id: candidateId,
      duplicate_of_candidate_id: existing.candidate_id,
      is_duplicate: true,
      flagged_for_review: true,
      review_reason: "same_identity_document_used_by_second_account",
      stripe_verification_session_id: sessionId,
    })
    .eq("id", existing.id);
  if (error) return { outcome: "error", message: `duplicate flag failed: ${error.message}` };
  return { outcome: "duplicate", identityHash, originalCandidateId: existing.candidate_id };
}
