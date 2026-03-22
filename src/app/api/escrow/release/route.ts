import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

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
 * - Candidate's share sent via payout API (Trolley/Payoneer/Wise)
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

      if (!user || user.user_metadata?.role !== "client") {
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

      // Initiate payout to candidate
      await initiatePayout(
        admin,
        period.engagements.candidate_id,
        Number(period.engagements.candidate_rate_usd)
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

      // Initiate payout
      await initiatePayout(
        admin,
        milestone.engagements.candidate_id,
        Number(milestone.amount_usd)
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
 * Initiate payout to candidate via their selected payout method.
 * In Phase 1 this logs the payout intent — full Trolley API integration
 * will be wired in the payout infrastructure step.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function initiatePayout(
  supabase: any,
  candidateId: string,
  amountUsd: number
) {
  const { data: candidate } = await supabase
    .from("candidates")
    .select("payout_method, payout_account_id, full_name, email")
    .eq("id", candidateId)
    .single();

  if (!candidate) return;

  // TODO: Replace with actual Trolley/Payoneer/Wise API call
  // For now, log the payout intent for manual processing
  console.log(
    `[StaffVA Payout] ${candidate.full_name} (${candidate.email}) — $${amountUsd} via ${candidate.payout_method || "not set"} — account: ${candidate.payout_account_id || "not set"}`
  );
}
