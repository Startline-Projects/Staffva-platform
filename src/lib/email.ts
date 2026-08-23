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

  // Retry transient failures. The verification email is the sharpest case: it
  // is sent inline during signup, login is hard-gated on email_verified, and
  // the only writer of that flag is the link inside this message — so a single
  // rate-limited send permanently bricks the account. Resend's default is a
  // couple of requests per second, and a spike puts signups well past that.
  const MAX_ATTEMPTS = 3;
  let lastMessage = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data, error } = await resend.emails.send(payload);

    if (!error) return data;

    lastMessage =
      typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : JSON.stringify(error);

    // 4xx other than 429 are permanent — a bad address or an unverified
    // sender will not succeed on a retry, and retrying wastes the caller's
    // request budget.
    const status =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number((error as { statusCode: unknown }).statusCode)
        : undefined;
    const retryable =
      status === undefined || status === 429 || (status >= 500 && status < 600);

    if (!retryable || attempt === MAX_ATTEMPTS) break;

    // 0.5s, then 1.5s. Short enough to stay inside a serverless request.
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt * attempt));
  }

  throw new Error(`Resend send failed after ${MAX_ATTEMPTS} attempts: ${lastMessage}`);
}
