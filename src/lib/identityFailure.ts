import { createClient } from "@supabase/supabase-js";

/**
 * Record an identity-verification failure where alerting can see it.
 *
 * Nothing in the identity flow wrote to vendor_failures. create-session only
 * console.error'd, and check-status swallowed its Stripe error entirely and
 * returned the unchanged "pending" — which the browser poll renders as "still
 * verifying". So a completely dead integration produced no operator signal at
 * all: zero sessions ever created, no submission since 2026-04-07, and not one
 * alert in five months.
 *
 * Never throws. A failure to record a failure must not become a second one.
 */
export async function recordIdentityFailure(
  operation: string,
  error: unknown,
  subjectId?: string,
  extra?: Record<string, unknown>
): Promise<void> {
  try {
    const message = error instanceof Error ? error.message : String(error);
    const status = (error as { statusCode?: number; status?: number } | null)?.statusCode
      ?? (error as { status?: number } | null)?.status
      ?? null;

    // A Stripe error on this path is almost never transient — the usual cause
    // is that Identity is not activated on the account, which affects every
    // candidate and does not heal on its own.
    const fatal =
      status === 400 || status === 401 || status === 403 ||
      /not.*(enabled|activated)|permission|capability/i.test(message);

    console.error(`[identity]${fatal ? " FATAL" : ""} ${operation}: ${message}`);

    await createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
      .from("vendor_failures")
      .insert({
        app: "platform",
        vendor: "stripe",
        operation: `identity.${operation}`,
        fatal,
        status_code: status,
        message: message.slice(0, 2000),
        context: { subject_id: subjectId ?? null, ...(extra ?? {}) },
      });
  } catch (loggingError) {
    console.error("[identity] could not record failure:", loggingError);
  }
}
