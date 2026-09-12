import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe";
import { recordIdentityFailure } from "@/lib/identityFailure";

/**
 * Collect verification verdicts Stripe already reached but we never recorded.
 *
 * A verification is decided by STRIPE, asynchronously, after the candidate is
 * redirected back — so the outcome arrives one of two ways: the webhook, or
 * the browser poll on /api/identity/check-status. Both can miss.
 *
 * The webhook misses if the endpoint does not subscribe to
 * identity.verification_session.*. Measured on production: webhook_log holds
 * ZERO identity events, ever. And webhook-reconcile cannot help, because it
 * only replays rows that are already IN webhook_log — a row is written only
 * after signature verification, so an event that was never delivered leaves no
 * trace to retry.
 *
 * The poll misses if the candidate closes the tab, loses the connection, or
 * takes longer than its 90 attempts. It only runs on the ?id_check=returning
 * trip, so coming back later never collects a pending verdict either.
 *
 * Between them, a candidate could complete verification successfully and have
 * it silently discarded, with nothing server-side ever looking again. This is
 * the thing that looks again.
 *
 * It asks Stripe about sessions WE already stored, so it costs nothing per
 * candidate beyond a retrieve, and it cannot invent a pass: the verdict comes
 * from Stripe or it does not happen.
 */

const MAX_PER_RUN = 50;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Anyone holding a session whose verdict we never wrote down. Ordered
  // oldest-first so a backlog drains in the order people were kept waiting.
  const { data: stuck, error } = await db
    .from("candidates")
    .select("id, identity_session_id, id_verification_status, id_verification_submitted_at")
    .not("identity_session_id", "is", null)
    .in("id_verification_status", ["pending", "failed"])
    .order("id_verification_submitted_at", { ascending: true, nullsFirst: true })
    .limit(MAX_PER_RUN);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }

  let resolved = 0;
  let stillPending = 0;
  const failures: string[] = [];

  for (const row of stuck ?? []) {
    if (!row.identity_session_id) continue;
    try {
      const session = await getStripe().identity.verificationSessions.retrieve(
        row.identity_session_id
      );

      if (session.status === "verified") {
        // Anchor first, exactly as the webhook does: the identity hash is what
        // makes the duplicate-document promise in the consent copy true, and
        // writing 'passed' without it would bank the status and lose the
        // evidence.
        const { recordVerifiedIdentity } = await import("@/lib/identityAnchor");
        const anchor = await recordVerifiedIdentity({
          supabase: db,
          stripe: getStripe(),
          candidateId: row.id,
          sessionId: row.identity_session_id,
        });
        if (anchor.outcome === "error") {
          await recordIdentityFailure("reconcile.anchor", new Error(anchor.message), row.id);
        }
        await db
          .from("candidates")
          .update({ id_verification_status: "passed" })
          .eq("id", row.id)
          // Never overwrite a human verdict that landed in the meantime.
          .in("id_verification_status", ["pending", "failed"]);
        resolved++;
        continue;
      }

      // requires_input is where every session STARTS and sits while the
      // person is still capturing. It only means a failed attempt once Stripe
      // attaches last_error — writing 'failed' for an unsubmitted session
      // would tell someone who simply abandoned the tab that they failed.
      if (session.status === "requires_input" && session.last_error) {
        await db
          .from("candidates")
          .update({ id_verification_status: "failed" })
          .eq("id", row.id)
          .eq("id_verification_status", "pending");
        resolved++;
        continue;
      }

      stillPending++;
    } catch (err) {
      failures.push(row.id);
      await recordIdentityFailure("reconcile.retrieve", err, row.id, {
        session_id: row.identity_session_id,
      });
    }
  }

  // Non-2xx when anything failed, so a silent-but-broken sweep is visible to
  // whatever watches the cron rather than reporting success.
  return NextResponse.json(
    { scanned: stuck?.length ?? 0, resolved, stillPending, failed: failures.length, failures },
    { status: failures.length > 0 ? 503 : 200 }
  );
}
