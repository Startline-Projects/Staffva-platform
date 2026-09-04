import { Resend } from "resend";
import { emailAllowed, freezeReason, type RecipientKind } from "@/lib/emailFreeze";

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

export class EmailSendError extends Error {
  /** HTTP status from Resend, when it gave one. */
  readonly status?: number;
  /** False for a fault no retry will fix — a bad key, an unverified sender. */
  readonly retryable: boolean;

  constructor(message: string, status: number | undefined, retryable: boolean) {
    super(message);
    this.name = "EmailSendError";
    this.status = status;
    this.retryable = retryable;
  }
}

export type SendEmailOptions = {
  /**
   * Attempts INSIDE this call. Default 3 for direct callers, who have no
   * retry of their own.
   *
   * The outbox drain passes 1: it owns retry and backoff already, and leaving
   * this at 3 multiplied out to 15 Resend calls per message — with the
   * internal sleeps landing inside the drain's own deadline, precisely during
   * the rate-limit storm the queue exists to absorb.
   */
  maxAttempts?: number;
  /**
   * Passed to Resend as Idempotency-Key. The outbox sends its row id, so a
   * send that succeeded just before the invocation was killed cannot be
   * delivered a second time when the row is reclaimed.
   */
  idempotencyKey?: string;
  /**
   * Who this is going to, and what it is. Together they decide whether the
   * candidate-email freeze permits the send.
   *
   * Optional rather than required, deliberately. Making it required would put
   * a mechanical edit through all 43 call sites at once, and a client invoice
   * or a staff alert mislabelled as candidate mail would be silently dropped —
   * trading a freeze leak for a worse, quieter failure. Unmarked sends behave
   * exactly as they always have; the paths that matter declare themselves.
   *
   * The one kind that can never send at all — `reference` — has no caller to
   * mislabel, because step 11 ships no code that mails a reference.
   */
  recipientKind?: RecipientKind;
  emailType?: string;
};

/** What a suppressed send returns. Suppression is not a failure: the caller
 *  did its job, and the message was withheld by policy. */
export type SuppressedResult = { suppressed: true; reason: string };

// A hung upstream must not outlive the caller's function budget. The outbox
// drain runs with maxDuration 60 and paces sends inside a 45s deadline.
const REQUEST_TIMEOUT_MS = 10_000;

function classify(error: unknown): { message: string; status?: number; retryable: boolean } {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : JSON.stringify(error);

  // Only a real number counts as a status.
  //
  // This was `Number(statusCode)`, which looks harmless and is not. On ANY
  // fetch-level failure — DNS, connection reset, TLS, Resend's edge briefly
  // unreachable — the SDK returns `{ name: "application_error", statusCode:
  // null, message: "Unable to fetch data..." }` (resend/dist/index.mjs:1310).
  // `"statusCode" in error` is true because the key is present, and
  // `Number(null)` is 0, so status became 0 — which is not undefined, not 429,
  // and not in the 5xx range. Every one of those branches missed, `retryable`
  // came out false, and the drain treated a passing network blip as a permanent
  // fault. That is precisely the transient failure the outbox exists to absorb,
  // and it was the one case guaranteed to burn a message instead.
  const rawStatus =
    typeof error === "object" && error !== null && "statusCode" in error
      ? (error as { statusCode: unknown }).statusCode
      : undefined;
  const status = typeof rawStatus === "number" ? rawStatus : undefined;

  // 4xx other than 429 are permanent — a bad address or an unverified sender
  // will not succeed on a retry, however long you wait. An absent or non-numeric
  // status is treated as retryable: unknown is not the same as hopeless.
  const retryable = status === undefined || status === 429 || (status >= 500 && status < 600);

  return { message, status, retryable };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendEmail(payload: any, options: SendEmailOptions = {}) {
  // The freeze, at the one place every send passes through.
  if (options.recipientKind) {
    const type = options.emailType ?? "unspecified";
    if (!emailAllowed(options.recipientKind, type)) {
      const reason = freezeReason(options.recipientKind, type);
      // Logged, not thrown. A frozen email is a policy outcome, not an error:
      // throwing here would make every caller's try/catch report the ACTION
      // as failed, and a video intro that saved fine would tell the candidate
      // it did not.
      console.warn(`[email] ${reason} to=${typeof payload?.to === "string" ? payload.to : "?"}`);
      return { suppressed: true, reason } as SuppressedResult;
    }
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Not retryable: no amount of waiting configures an environment variable.
    throw new EmailSendError("RESEND_API_KEY is not configured", undefined, false);
  }

  const maxAttempts = options.maxAttempts ?? 3;
  const resend = new Resend(apiKey);

  let last: { message: string; status?: number; retryable: boolean } = {
    message: "no attempt made",
    retryable: false,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // The SDK exposes no abort signal, so bound how long we WAIT rather than
    // the request itself. That is what the caller actually needs: the outbox
    // drain must finish inside maxDuration, and a send left dangling is
    // harmless because the idempotency key stops a later retry from
    // delivering the same message twice.
    const { data, error } = await Promise.race([
      resend.emails.send(payload, { idempotencyKey: options.idempotencyKey }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new EmailSendError("Resend timed out", undefined, true)),
          REQUEST_TIMEOUT_MS
        )
      ),
    ]);

    if (!error) return data;

    last = classify(error);

    if (!last.retryable || attempt === maxAttempts) break;

    // 0.5s, then 1.5s. Short enough to stay inside a serverless request.
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt * attempt));
  }

  const attempted = maxAttempts > 1 ? ` after ${maxAttempts} attempts` : "";
  throw new EmailSendError(
    `Resend send failed${attempted}: ${last.message}`,
    last.status,
    last.retryable
  );
}
