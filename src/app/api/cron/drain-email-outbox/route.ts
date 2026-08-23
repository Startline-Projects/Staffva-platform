import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail, EmailSendError } from "@/lib/email";
import { nextAttemptAt } from "@/lib/emailOutbox";
import { hasCronSecret } from "@/lib/auth";

/**
 * GET /api/cron/drain-email-outbox
 *
 * Sends whatever is due in public.email_outbox.
 *
 * Runs every minute — the finest granularity Vercel cron offers — so a
 * verification email is queued instantly at signup and dispatched within ~60s.
 *
 * Paced rather than parallel on purpose. Resend's default is a couple of
 * requests per second, and the whole reason this queue exists is that a spike's
 * peak minute (~127 signups) sits right on that limit. Blasting the backlog
 * concurrently would reproduce the failure the outbox was built to prevent.
 *
 * Fails closed when CRON_SECRET is unset.
 */

// ~2 sends/second, matching Resend's documented default.
const SEND_INTERVAL_MS = 500;
const BATCH_SIZE = 50;
// Leave headroom inside maxDuration 60 so the loop exits cleanly rather than
// being killed mid-send with a row claimed.
const DEADLINE_MS = 45_000;
// Comfortably above maxDuration, so a legitimately in-flight send is never stolen.
const STRANDED_AFTER_MS = 5 * 60 * 1000;

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  if (!hasCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const supabase = getAdminClient();
  const results = { sent: 0, retried: 0, failed: 0, reclaimed: 0, skipped: 0 };

  // Reclaim rows stranded by a killed invocation. Without this a deploy or a
  // timeout mid-send leaves the row in 'sending' forever: not due, not failed,
  // never alerted — the same silent loss the screening queue had.
  //
  // Done in SQL because it must COUNT the killed attempt. Leaving attempts
  // untouched meant a message that reliably hangs would be killed, reclaimed
  // and retried forever without ever failing or alerting.
  const { data: reclaimed } = await supabase.rpc("reclaim_stranded_emails", {
    p_stranded_after_seconds: Math.round(STRANDED_AFTER_MS / 1000),
  });
  results.reclaimed = typeof reclaimed === "number" ? reclaimed : 0;

  const { data: due } = await supabase
    .from("email_outbox")
    .select("*")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date(started).toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (!due || due.length === 0) {
    return NextResponse.json({ message: "Nothing due", ...results });
  }

  for (const row of due) {
    if (Date.now() - started > DEADLINE_MS) {
      results.skipped = due.length - (results.sent + results.retried + results.failed);
      break;
    }

    // Claim. Only the run that flips pending -> sending owns this row, so
    // overlapping invocations cannot send the same email twice.
    const { data: claimed } = await supabase
      .from("email_outbox")
      .update({ status: "sending", claimed_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id");

    if (!claimed || claimed.length === 0) continue;

    try {
      await sendEmail(
        {
          from: row.from_email,
          to: row.to_email,
          subject: row.subject,
          html: row.html,
        },
        {
          // This loop owns retry and backoff. Letting sendEmail retry too
          // multiplied out to 15 Resend calls per message, with its internal
          // sleeps eating this run's deadline during exactly the rate-limit
          // storm the queue exists to absorb.
          maxAttempts: 1,
          // A send that succeeded just before the invocation was killed must
          // not be delivered twice when the row is reclaimed.
          idempotencyKey: row.id,
        }
      );

      await supabase
        .from("email_outbox")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          attempts: row.attempts + 1,
          claimed_at: null,
          last_error: null,
        })
        .eq("id", row.id);
      results.sent++;
    } catch (err) {
      const attempts = row.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      // A missing key, a 401, an unverified sender or a bad address will not
      // come good on a retry. Burning all five attempts on those only delays
      // the alert — by hours, on the email whose delay costs a signup.
      const permanent = err instanceof EmailSendError && !err.retryable;
      const exhausted = permanent || attempts >= row.max_attempts;

      await supabase
        .from("email_outbox")
        .update({
          status: exhausted ? "failed" : "pending",
          attempts,
          claimed_at: null,
          last_error: message.slice(0, 1000),
          next_attempt_at: exhausted ? row.next_attempt_at : nextAttemptAt(attempts).toISOString(),
        })
        .eq("id", row.id);

      if (exhausted) {
        results.failed++;
        // A give-up on the verification path means a candidate who can never
        // log in. Record it where the failure query will find it rather than
        // leaving it only in a function log.
        await supabase.from("vendor_failures").insert({
          app: "platform",
          vendor: "resend",
          operation: "email.outbox.drain",
          fatal: true,
          message: (permanent
            ? `Permanent failure, not retried: ${message}`
            : `Gave up after ${attempts} attempts: ${message}`).slice(0, 2000),
          context: {
            emailType: row.email_type,
            outboxId: row.id,
            candidateId: row.candidate_id,
          },
        });
      } else {
        results.retried++;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, SEND_INTERVAL_MS));
  }

  // Surface a growing backlog: pending rows older than 15 minutes mean the
  // drain is not keeping up, which on the verification path means signups are
  // silently stalling.
  const { count: stale } = await supabase
    .from("email_outbox")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending")
    .lt("created_at", new Date(started - 15 * 60 * 1000).toISOString());

  return NextResponse.json({ ...results, staleBacklog: stale ?? 0 });
}
