import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Runs every 15 minutes — retries failed webhooks, alerts on permanent failures
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getAdminClient();
  let retriedCount = 0;
  let alertedCount = 0;
  const errors: string[] = [];

  // ── Stripe webhook_log reconciliation ──

  // Find unprocessed webhooks with retry_count < 3
  const { data: failedWebhooks } = await supabase
    .from("webhook_log")
    .select("*")
    .eq("processed", false)
    .lt("retry_count", 3)
    .order("received_at", { ascending: true })
    .limit(20);

  if (failedWebhooks && failedWebhooks.length > 0) {
    for (const wh of failedWebhooks) {
      try {
        // Re-process the webhook by calling the processor
        const processed = await reprocessStripeWebhook(supabase, wh);

        if (processed) {
          await supabase
            .from("webhook_log")
            .update({
              processed: true,
              processed_at: new Date().toISOString(),
              retry_count: wh.retry_count + 1,
              error: null,
            })
            .eq("id", wh.id);
          retriedCount++;
        } else {
          await supabase
            .from("webhook_log")
            .update({
              retry_count: wh.retry_count + 1,
              error: "Retry failed — event could not be reprocessed",
            })
            .eq("id", wh.id);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        await supabase
          .from("webhook_log")
          .update({
            retry_count: wh.retry_count + 1,
            error: `Retry ${wh.retry_count + 1} failed: ${msg}`,
          })
          .eq("id", wh.id);
        errors.push(`Webhook ${wh.id}: ${msg}`);
      }
    }
  }

  // Find permanently failed webhooks (retry_count >= 3, not processed)
  const { data: permanentFailures } = await supabase
    .from("webhook_log")
    .select("*")
    .eq("processed", false)
    .gte("retry_count", 3)
    .is("processed_at", null) // Never alerted yet — use processed_at as alert marker
    .order("received_at", { ascending: true })
    .limit(10);

  if (permanentFailures && permanentFailures.length > 0 && process.env.RESEND_API_KEY) {
    const rows = permanentFailures
      .map(
        (wh) =>
          `<tr>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${wh.event_type}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${wh.provider}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${new Date(wh.received_at).toLocaleString()}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;color:red;">${wh.error || "Unknown"}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${wh.retry_count}</td>
          </tr>`
      )
      .join("");

    try {
      await sendEmail({
        from: "StaffVA <notifications@staffva.com>",
        to: "sam@glostaffing.com",
        subject: `⚠ ${permanentFailures.length} webhook(s) permanently failed after 3 retries`,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:700px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">Webhook Failure Alert</h2>
            <p style="color:#444;font-size:14px;">${permanentFailures.length} webhook event(s) failed after 3 retry attempts and require manual investigation.</p>
            <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #e0e0e0;">
              <thead>
                <tr style="background:#f9f9f9;">
                  <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Event Type</th>
                  <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Provider</th>
                  <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Received</th>
                  <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Error</th>
                  <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Retries</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            <p style="color:#444;font-size:14px;">
              Check the <code>webhook_log</code> table in Supabase for full payload details.
            </p>
            <a href="https://staffva.com/admin" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Go to Admin Panel</a>
          </div>
        `,
      }, { recipientKind: "staff", emailType: "webhook_failures" });

      // Mark as alerted using processed_at as the alert timestamp
      for (const wh of permanentFailures) {
        await supabase
          .from("webhook_log")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", wh.id);
      }

      alertedCount = permanentFailures.length;
    } catch (err) {
      errors.push(`Alert email failed: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  }

  // ── Trolley trolley_log reconciliation (same pattern) ──

  const { data: failedTrolley } = await supabase
    .from("trolley_log")
    .select("*")
    .eq("processed", false)
    .lt("retry_count", 3)
    .order("received_at", { ascending: true })
    .limit(20);

  let trolleyRetried = 0;
  if (failedTrolley && failedTrolley.length > 0) {
    for (const tl of failedTrolley) {
      // Trolley retry logic — increment count, log attempt
      await supabase
        .from("trolley_log")
        .update({
          retry_count: tl.retry_count + 1,
          error: `Retry ${tl.retry_count + 1} — manual processing required`,
        })
        .eq("id", tl.id);
      trolleyRetried++;
    }
  }

  // Trolley permanent failures alert
  const { data: trolleyPermanent } = await supabase
    .from("trolley_log")
    .select("*")
    .eq("processed", false)
    .gte("retry_count", 3)
    .is("processed_at", null)
    .limit(10);

  if (trolleyPermanent && trolleyPermanent.length > 0 && process.env.RESEND_API_KEY) {
    try {
      await sendEmail({
        from: "StaffVA <notifications@staffva.com>",
        to: "sam@glostaffing.com",
        subject: `⚠ ${trolleyPermanent.length} Trolley payout callback(s) permanently failed`,
        html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;">
          <h2 style="color:#1C1B1A;">Trolley Payout Failure Alert</h2>
          <p style="color:#444;font-size:14px;">${trolleyPermanent.length} Trolley payout callback(s) failed after 3 retries. Check the <code>trolley_log</code> table in Supabase.</p>
        </div>`,
      }, { recipientKind: "staff", emailType: "trolley_callback_failures" });

      for (const tl of trolleyPermanent) {
        await supabase
          .from("trolley_log")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", tl.id);
      }
    } catch { /* silent */ }
  }

  return NextResponse.json({
    message: "Webhook reconciliation complete",
    stripe: { retried: retriedCount, alerted: alertedCount },
    trolley: { retried: trolleyRetried },
    errors: errors.length > 0 ? errors : undefined,
  });
}

/**
 * Re-process a Stripe webhook event from stored payload.
 * Returns true if processing succeeded.
 */
async function reprocessStripeWebhook(
  supabase: ReturnType<typeof getAdminClient>,
  wh: { event_type: string; payload: Record<string, unknown> }
): Promise<boolean> {
  const payload = wh.payload;

  switch (wh.event_type) {
    case "identity.verification_session.verified": {
      const candidateId = (payload.metadata as Record<string, string>)?.candidate_id;
      if (!candidateId) return false;
      await supabase
        .from("candidates")
        .update({ id_verification_status: "passed" })
        .eq("id", candidateId);
      return true;
    }

    case "identity.verification_session.requires_input": {
      const candidateId = (payload.metadata as Record<string, string>)?.candidate_id;
      if (!candidateId) return false;
      // Reconcile replays STALE events by definition — only move a row that
      // is still waiting. Without the guard, a late requires_input replay
      // would regress an already-landed 'passed' (or dissolve a review hold).
      await supabase
        .from("candidates")
        .update({ id_verification_status: "failed" })
        .eq("id", candidateId)
        .eq("id_verification_status", "pending");
      return true;
    }

    case "identity.verification_session.processing": {
      const candidateId = (payload.metadata as Record<string, string>)?.candidate_id;
      if (!candidateId) return false;
      // Mirrors the live webhook (see stripe/webhook route): 'processing'
      // means SUBMITTED, not manual review — stamp the time, change nothing
      // else. The old copy here wrote manual_review and could overwrite a
      // landed 'passed' with reconcile-time data.
      await supabase
        .from("candidates")
        .update({ id_verification_submitted_at: new Date().toISOString() })
        .eq("id", candidateId);
      return true;
    }

    case "payment_intent.succeeded": {
      const engagementId = (payload.metadata as Record<string, string>)?.engagement_id;
      const periodId = (payload.metadata as Record<string, string>)?.period_id;
      const milestoneId = (payload.metadata as Record<string, string>)?.milestone_id;
      if (!engagementId) return false;

      const now = new Date().toISOString();

      if (periodId) {
        const { data: period } = await supabase
          .from("payment_periods")
          .select("period_end")
          .eq("id", periodId)
          .single();

        const autoRelease = period?.period_end
          ? new Date(new Date(period.period_end).getTime() + 48 * 60 * 60 * 1000).toISOString()
          : null;

        await supabase
          .from("payment_periods")
          .update({ status: "funded", funded_at: now, auto_release_at: autoRelease })
          .eq("id", periodId)
          // Same compare-and-swap as the live webhook handler: never rewrite an
          // already-funded/released period back to 'funded' on a reconcile pass.
          .is("funded_at", null);
      }

      if (milestoneId) {
        await supabase
          .from("milestones")
          .update({ status: "funded", funded_at: now })
          .eq("id", milestoneId)
          .eq("status", "pending");
      }

      return true;
    }

    case "checkout.session.completed": {
      const interviewRequestId = (payload.metadata as Record<string, string>)?.interview_request_id;
      if (!interviewRequestId) return false;

      await supabase
        .from("interview_requests")
        .update({
          payment_status: "paid",
          stripe_payment_id: (payload.payment_intent as string) || null,
        })
        .eq("id", interviewRequestId);
      return true;
    }

    default:
      // Unknown event type — can't retry
      return false;
  }
}
