import { Resend } from "resend";

/**
 * Send an email, throwing on failure.
 *
 * resend.emails.send() RESOLVES with `{ data, error }` — it does not throw on
 * API-level failures (invalid key, unverified sender domain, rate limit,
 * suppressed recipient). Call sites across this codebase wrap the send in
 * try/catch and treat "no exception" as success, so those failures were
 * invisible: routes logged status 'sent', crons stamped rows as processed or
 * alerted, and the message was never retried. In several places an idempotency
 * guard then permanently blocked a resend.
 *
 * Converting the returned error into a throw makes all of those existing
 * try/catch blocks correct without restructuring them.
 *
 * Also constructs the client per call rather than at module scope, so a missing
 * RESEND_API_KEY can no longer crash a whole route at import time.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendEmail(payload: any) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send(payload);

  if (error) {
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : JSON.stringify(error);
    throw new Error(`Resend send failed: ${message}`);
  }

  return data;
}
