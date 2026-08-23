import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Rate limiting.
 *
 * Nothing bounded how often any endpoint could be driven, and several spend
 * money per call — a signup queues a verification email, an application
 * queues an Anthropic screening. Reopening signup is what makes that
 * reachable from outside.
 *
 * Backed by the shared Postgres instance (see migration: check_rate_limit) so
 * there is no extra vendor and no extra environment variable to forget. The
 * counter is a single atomic INSERT ... ON CONFLICT ... RETURNING, so
 * concurrent requests cannot both observe the same pre-increment value.
 *
 * Limits are a ceiling on abuse, not a throttle on use.
 */

export type RateLimit = { limit: number; windowSeconds: number };

export const LIMITS = {
  // Per IP. Deliberately loose: candidates in the same country frequently
  // share NAT'd addresses, so a tight per-IP limit would block real users
  // before it blocked a script. The route already enforces a 60s per-account
  // cooldown; this only stops someone hammering it across many accounts.
  verificationEmail: { limit: 30, windowSeconds: 3600 },
} satisfies Record<string, RateLimit>;

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Returns null when the caller may proceed, or a 429 response to return.
 *
 * Fails OPEN. If the limiter itself errors the request is allowed: this is a
 * cost ceiling, and refusing signups because a counter table is unreachable
 * would be a worse outcome than the spend it prevents. The failure is logged
 * rather than swallowed.
 */
export async function enforceRateLimit(
  key: string,
  { limit, windowSeconds }: RateLimit
): Promise<NextResponse | null> {
  try {
    const { data: allowed, error } = await getAdminClient().rpc("check_rate_limit", {
      p_bucket: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      console.error(`[rate-limit] check failed for ${key}, allowing:`, error.message);
      return null;
    }

    if (allowed === false) {
      console.warn(`[rate-limit] blocked ${key} (>${limit} per ${windowSeconds}s)`);
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(windowSeconds) } }
      );
    }

    return null;
  } catch (err) {
    console.error(`[rate-limit] check threw for ${key}, allowing:`, err);
    return null;
  }
}

/** Best-effort client address, for routes with no authenticated identity. */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
