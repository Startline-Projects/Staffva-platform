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

export function nextAttemptAt(attempts: number): Date {
  const minutes =
    RETRY_BACKOFF_MINUTES[Math.min(attempts, RETRY_BACKOFF_MINUTES.length - 1)];
  return new Date(Date.now() + minutes * 60 * 1000);
}
