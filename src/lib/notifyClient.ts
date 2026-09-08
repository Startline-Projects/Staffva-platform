import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Write one in-app notification for a client — the bell in the client portal
 * topbar reads these (migration 00224).
 *
 * FAIL-SOFT, deliberately, and for the same reason as notifyCandidate: every
 * call site is a business action (a counter sent, a milestone marked, a
 * contract signed) that must not fail because its notification could not be
 * written. Unlike the candidate side, the client also has a live email
 * channel — client email is not frozen — so the bell is a second signal
 * rather than the only one.
 *
 * Requires the SERVICE-ROLE client. The table grants no INSERT to the browser
 * roles: a client who could write these could manufacture "your candidate
 * accepted your offer". Passing the caller's client fails, and the failure is
 * logged rather than swallowed silently.
 */

export type ClientNotificationCategory =
  | "offer"
  | "message"
  | "contract"
  | "engagement"
  | "payment"
  | "interview"
  | "system";

export async function notifyClient(
  admin: SupabaseClient,
  n: {
    clientId: string;
    category: ClientNotificationCategory;
    title: string;
    body?: string;
    /** App-relative path; the DB CHECK refuses anything else. */
    route?: string;
    /** Set at retry-prone sites (webhooks, crons); a repeat becomes a no-op. */
    dedupeKey?: string;
  }
): Promise<void> {
  const { error } = await admin.from("client_notifications").insert({
    client_id: n.clientId,
    category: n.category,
    title: n.title,
    body: n.body ?? null,
    route: n.route ?? null,
    dedupe_key: n.dedupeKey ?? null,
  });
  // 23505 = the dedupe index doing its job on a retried webhook — not an error.
  if (error && error.code !== "23505") {
    console.error("[notify-client] write failed:", n.category, n.clientId, error.message);
  }
}
