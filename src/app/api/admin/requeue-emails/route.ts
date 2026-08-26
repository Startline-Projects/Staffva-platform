import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hasCronSecret } from "@/lib/auth";

/**
 * POST /api/admin/requeue-emails
 *
 * Puts emails the drain gave up on back in the queue.
 *
 * Rows reach status='failed' and stay there forever — nothing in either app
 * moves them back, and the table is revoked from anon and authenticated, so no
 * client can. That was fine only while nothing could fail a whole backlog at
 * once, which turned out not to be true: a permanent failure was treated as
 * exhausted on attempt 1 rather than after max_attempts, so a bad key or an
 * unverified sender burned 50 rows a minute with no way back. Every one of those
 * rows is a verification email, which is a person who can never log in.
 *
 * Deliberately NOT on a schedule. Requeueing is only ever correct AFTER someone
 * has fixed whatever caused the failures; on a cron it would simply feed the
 * same backlog into the same fault on a loop. It is a button for a human who has
 * just repaired something.
 *
 * Gated on CRON_SECRET rather than a session, because it is an operational tool
 * and the alternative is building an admin UI for something that should be used
 * roughly never.
 *
 *   curl -X POST https://staffva.com/api/admin/requeue-emails \
 *     -H "Authorization: Bearer $CRON_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"sinceHours": 24, "emailType": "verification"}'
 */

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!hasCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let sinceHours = 24;
  let emailType: string | null = null;

  try {
    const body = await request.json();
    if (typeof body?.sinceHours === "number") sinceHours = body.sinceHours;
    if (typeof body?.emailType === "string") emailType = body.emailType;
  } catch {
    // No body is fine — the defaults are the common case.
  }

  // Bounded so a typo cannot rake up the entire history of the table and mail
  // links that expired months ago.
  if (!Number.isFinite(sinceHours) || sinceHours <= 0 || sinceHours > 24 * 30) {
    return NextResponse.json(
      { error: "sinceHours must be between 1 and 720" },
      { status: 400 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase.rpc("requeue_failed_emails", {
    p_since_hours: Math.round(sinceHours),
    p_email_type: emailType,
  });

  if (error) {
    console.error("[requeue-emails] failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The function requeues at most one row per address — the newest — because
  // profiles.email_verification_token only holds the most recent token, so
  // older rows carry links that can no longer verify anyone.
  return NextResponse.json({
    requeued: data ?? 0,
    sinceHours: Math.round(sinceHours),
    emailType,
    note: "One row per address (newest only). They will send on the next drain run.",
  });
}
