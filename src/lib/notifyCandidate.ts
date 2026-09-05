import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Write one in-app notification for a candidate — the bell on the Atlas
 * dashboard shell reads these.
 *
 * FAIL-SOFT, deliberately. Every call site is a business action (an offer
 * sent, a contract countersigned, a photo rejected) that must not fail
 * because its notification could not be written. The inverse of the email
 * outbox's contract: mail is queued-or-error because delivery is the point;
 * a notification is best-effort because the dashboard is the fallback surface
 * for every fact it announces.
 *
 * Requires the SERVICE-ROLE client. The table grants no INSERT to the browser
 * roles — a candidate must not be able to manufacture their own "you've been
 * approved". Passing the caller's client here fails, and that failure is
 * logged rather than swallowed silently.
 */

export type NotificationCategory =
  | "offer"
  | "message"
  | "contract"
  | "review"
  | "profile"
  | "payout"
  | "interview"
  | "system";

export async function notifyCandidate(
  admin: SupabaseClient,
  n: {
    candidateId: string;
    category: NotificationCategory;
    title: string;
    body?: string;
    /** App-relative path; the DB CHECK refuses anything not starting with "/". */
    route?: string;
    /** Set at retry-prone sites (webhooks, crons); a repeat becomes a no-op. */
    dedupeKey?: string;
  }
): Promise<void> {
  const { error } = await admin.from("candidate_notifications").insert({
    candidate_id: n.candidateId,
    category: n.category,
    title: n.title,
    body: n.body ?? null,
    route: n.route ?? null,
    dedupe_key: n.dedupeKey ?? null,
  });
  // 23505 = the dedupe index doing its job on a retried webhook — not an error.
  if (error && error.code !== "23505") {
    console.error("[notify] write failed:", n.category, n.candidateId, error.message);
  }
}
