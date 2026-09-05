import type { RecipientKind } from "@/lib/emailFreeze";
import { createClient } from "@supabase/supabase-js";

/**
 * Durable email queue.
 *
 * Sending inline put a third-party call on the request path. That was worst on
 * signup: login is gated on profiles.email_verified, whose only writer is the
 * link inside the verification email, so a single rejected send left an account
 * permanently unusable — and the peak minute of a spike lands right on Resend's
 * default rate limit.
 *
 * enqueueEmail() is a single INSERT. It returns as soon as the row is durable;
 * /api/cron/drain-email-outbox does the sending, with backoff and retries.
 *
 * Not every sendEmail() call site has been migrated — this is deliberately
 * introduced on the path where failure is unrecoverable. Other callers can move
 * over incrementally; sendEmail() still works and still throws.
 */

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export type OutboxEmail = {
  to: string;
  subject: string;
  html: string;
  from?: string;
  emailType: string;
  /**
   * Who this is for. REQUIRED, because the drain re-checks the candidate email
   * freeze at send time and the column defaults to 'candidate' — so a staff
   * alert queued without it is silently suppressed by the freeze it was never
   * subject to. That is not hypothetical: it is exactly what would have
   * happened to step 15's unanswered-message digest.
   */
  recipientKind: RecipientKind;
  candidateId?: string | null;
  /**
   * Natural key for "this exact message". Backed by a unique index, so an
   * enqueue can be retried and a double form submit cannot send twice.
   * Include whatever makes the message unique — e.g. `verification:<token>`.
   */
  dedupeKey?: string;
};

const DEFAULT_FROM = "StaffVA <notifications@staffva.com>";

/**
 * Queue an email for delivery.
 *
 * Throws if the row could not be written — the caller genuinely failed to
 * queue, and for something like verification that must be surfaced, not
 * swallowed. A duplicate dedupe_key is NOT an error: the message is already
 * queued, which is the outcome the caller wanted.
 */
export async function enqueueEmail(email: OutboxEmail): Promise<void> {
  const { error } = await getAdminClient().from("email_outbox").insert({
    to_email: email.to,
    from_email: email.from ?? DEFAULT_FROM,
    subject: email.subject,
    html: email.html,
    email_type: email.emailType,
    recipient_kind: email.recipientKind,
    candidate_id: email.candidateId ?? null,
    dedupe_key: email.dedupeKey ?? null,
  });

  // 23505 = unique_violation on dedupe_key. Already queued; nothing to do.
  if (error && error.code !== "23505") {
    throw new Error(`Could not queue ${email.emailType} email: ${error.message}`);
  }
}

/**
 * Backoff schedule in minutes, indexed by attempt number. Deliberately starts
 * short — a verification email that took ten minutes to arrive is a lost
 * signup — then widens for problems that clearly are not transient.
 */
export const RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 240];

/**
 * @param attempts how many attempts have now been made (1 after the first
 *   failure). Indexing must therefore be attempts - 1, or the first entry is
 *   never used and every wait is one step too long — which pushed give-up from
 *   T+81min out to T+320min, on the email whose delay costs a signup.
 */
export function nextAttemptAt(attempts: number): Date {
  const index = Math.min(Math.max(attempts - 1, 0), RETRY_BACKOFF_MINUTES.length - 1);
  return new Date(Date.now() + RETRY_BACKOFF_MINUTES[index] * 60 * 1000);
}
