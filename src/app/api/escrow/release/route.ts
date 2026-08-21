import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/escrow/release
 *
 * Releases escrowed funds:
 * - StaffVA keeps 10% (already in Stripe account)
 * - Candidate's share sent via Stripe Connect transfer to their Express account
 * - Updates payment_period or milestone status to 'released'
 * - Triggers verified earnings update via DB trigger
 *
 * Body: { periodId?, milestoneId?, triggeredBy: 'client' | 'auto' }
 */
export async function POST(request: Request) {
  try {
    const { periodId, milestoneId, triggeredBy } = await request.json();

    if (!periodId && !milestoneId) {
      return NextResponse.json(
        { error: "periodId or milestoneId required" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();

    // If triggered by client (not auto-release), verify auth
    if (triggeredBy === "client") {
      const supabase = await createServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || user.app_metadata?.role !== "client") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
    }

    const now = new Date().toISOString();

    if (periodId) {
      // Release a payment period
      const { data: period } = await admin
        .from("payment_periods")
        .select("*, engagements!inner(candidate_id, candidate_rate_usd)")
        .eq("id", periodId)
        .single();

      if (!period || period.status !== "funded") {
        return NextResponse.json(
          { error: "Period not found or not in funded state" },
          { status: 400 }
        );
      }

      // Check if dispute was filed
      const { count: disputeCount } = await admin
        .from("disputes")
        .select("*", { count: "exact", head: true })
        .eq("period_id", periodId)
        .is("resolved_at", null);

      if (disputeCount && disputeCount > 0) {
        return NextResponse.json(
          { error: "Cannot release — active dispute on this period" },
          { status: 400 }
        );
      }

      // Update period status to released
      // The DB trigger update_verified_earnings will auto-increment candidate earnings
      await admin
        .from("payment_periods")
        .update({ status: "released", released_at: now })
        .eq("id", periodId);

      // Initiate Stripe Connect payout — non-blocking (client sees release succeed even if payout fails)
      await initiatePayout(
        admin,
        period.engagements.candidate_id,
        Number(period.amount_usd),
        "period",
        periodId
      );

      return NextResponse.json({
        released: true,
        type: "period",
        id: periodId,
        amount: period.amount_usd,
      });
    }

    if (milestoneId) {
      // Release a milestone
      const { data: milestone } = await admin
        .from("milestones")
        .select("*, engagements!inner(candidate_id)")
        .eq("id", milestoneId)
        .single();

      if (!milestone) {
        return NextResponse.json(
          { error: "Milestone not found" },
          { status: 404 }
        );
      }

      // Can release from 'candidate_marked_complete' (client approval)
      // or 'approved' state
      if (
        milestone.status !== "candidate_marked_complete" &&
        milestone.status !== "approved"
      ) {
        return NextResponse.json(
          { error: "Milestone not ready for release" },
          { status: 400 }
        );
      }

      // Check for active disputes
      const { count: disputeCount } = await admin
        .from("disputes")
        .select("*", { count: "exact", head: true })
        .eq("milestone_id", milestoneId)
        .is("resolved_at", null);

      if (disputeCount && disputeCount > 0) {
        return NextResponse.json(
          { error: "Cannot release — active dispute on this milestone" },
          { status: 400 }
        );
      }

      // Update milestone to released
      await admin
        .from("milestones")
        .update({
          status: "released",
          approved_at: milestone.approved_at || now,
          released_at: now,
        })
        .eq("id", milestoneId);

      // Initiate Stripe Connect payout — non-blocking
      await initiatePayout(
        admin,
        milestone.engagements.candidate_id,
        Number(milestone.amount_usd),
        "milestone",
        milestoneId
      );

      return NextResponse.json({
        released: true,
        type: "milestone",
        id: milestoneId,
        amount: milestone.amount_usd,
      });
    }

    return NextResponse.json({ error: "Nothing to release" }, { status: 400 });
  } catch (error) {
    console.error("Escrow release error:", error);
    return NextResponse.json(
      { error: "Failed to release funds" },
      { status: 500 }
    );
  }
}

/**
 * Initiate payout to candidate via Stripe Connect transfer.
 *
 * - If the candidate has no Stripe account or has not completed onboarding,
 *   marks the record as payout_failed and sends a Resend email to the candidate.
 *   Does not block the escrow release response.
 * - If onboarding is complete, creates a Stripe Transfer to the candidate's
 *   Express account. Stripe deducts transfer fees from the connected account —
 *   we pass the full payout amount without adjustment.
 * - On success: writes stripe_transfer_id and payout_fired_at back to the record.
 * - On failure: writes payout_failed = true and payout_failure_reason for manual review.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function initiatePayout(
  admin: any,
  candidateId: string,
  amountUsd: number,
  recordType: "period" | "milestone",
  recordId: string
) {
  const table = recordType === "period" ? "payment_periods" : "milestones";

  const { data: candidate } = await admin
    .from("candidates")
    .select("stripe_account_id, stripe_onboarding_complete, full_name, email")
    .eq("id", candidateId)
    .single();

  if (!candidate) return;

  // Guard: Stripe account not set up or onboarding incomplete
  if (!candidate.stripe_account_id || !candidate.stripe_onboarding_complete) {
    await admin
      .from(table)
      .update({
        payout_failed: true,
        payout_failure_reason: "Stripe account not set up or onboarding incomplete",
      })
      .eq("id", recordId);

    // Notify candidate to set up their payout account
    if (process.env.RESEND_API_KEY && candidate.email) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "StaffVA <notifications@staffva.com>",
            to: candidate.email,
            subject: "Action required — set up your payout account to receive your payment",
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Set Up Your Payout Account</h2>
              <p style="color:#444;font-size:14px;">Hi ${candidate.full_name},</p>
              <p style="color:#444;font-size:14px;line-height:1.6;">A payment of <strong>$${amountUsd.toFixed(2)}</strong> has been released for you, but we were unable to process it because your Stripe payout account is not yet set up.</p>
              <p style="color:#444;font-size:14px;line-height:1.6;">Please complete your payout account setup from your dashboard. Once active, our team will manually process this payment.</p>
              <a href="https://staffva.com/candidate/dashboard" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Set Up Payouts Now</a>
              <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
            </div>`,
          }),
        });
      } catch { /* silent */ }
    }

    // Flag for admin visibility
    console.error(
      `[StaffVA Payout Alert] Payout failed — candidate ${candidateId} has no Stripe account. Record: ${table}/${recordId} — $${amountUsd}`
    );
    return;
  }

  // Attempt Stripe Connect transfer
  try {
    const transfer = await stripe.transfers.create({
      amount: Math.round(amountUsd * 100), // convert to cents
      currency: "usd",
      destination: candidate.stripe_account_id,
      transfer_group: recordId,
    });

    await admin
      .from(table)
      .update({
        stripe_transfer_id: transfer.id,
        payout_fired_at: new Date().toISOString(),
      })
      .eq("id", recordId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Stripe error";

    await admin
      .from(table)
      .update({
        payout_failed: true,
        payout_failure_reason: message,
      })
      .eq("id", recordId);

    // Flag for manual review — do not retry automatically
    console.error(
      `[StaffVA Payout Alert] Stripe transfer failed — candidate ${candidateId}, record ${table}/${recordId}: ${message}`
    );
  }
}
