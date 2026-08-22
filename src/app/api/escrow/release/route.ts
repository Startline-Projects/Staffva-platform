import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { initiatePayout } from "@/lib/payouts";

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
    const { periodId, milestoneId } = await request.json();

    if (!periodId && !milestoneId) {
      return NextResponse.json(
        { error: "periodId or milestoneId required" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();

    // Require an authenticated client. Ownership of the specific engagement is
    // verified per period/milestone below. Previously this ran only when
    // triggeredBy === "client", so any other value (or none) skipped auth
    // entirely — an unauthenticated fund release.
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || user.app_metadata?.role !== "client") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const { data: callerClient } = await admin
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .single();
    if (!callerClient) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const now = new Date().toISOString();

    if (periodId) {
      // Release a payment period
      const { data: period } = await admin
        .from("payment_periods")
        .select("*, engagements!inner(candidate_id, candidate_rate_usd, client_id)")
        .eq("id", periodId)
        .single();

      if (!period || period.status !== "funded") {
        return NextResponse.json(
          { error: "Period not found or not in funded state" },
          { status: 400 }
        );
      }

      if (period.engagements.client_id !== callerClient.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
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

      // Update period status to released.
      // The DB trigger update_verified_earnings auto-increments candidate
      // earnings on any not-released -> released transition, and the payout
      // below moves real money, so this transition must happen exactly once.
      // Compare-and-swap on the previous status: if a concurrent request (or a
      // retry) already released this period, we affect 0 rows and stop here
      // rather than paying twice.
      const { data: releasedPeriod } = await admin
        .from("payment_periods")
        .update({ status: "released", released_at: now })
        .eq("id", periodId)
        .eq("status", "funded")
        .select("id")
        .maybeSingle();

      if (!releasedPeriod) {
        return NextResponse.json(
          { error: "Period is no longer in a releasable state" },
          { status: 409 }
        );
      }

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
        .select("*, engagements!inner(candidate_id, client_id)")
        .eq("id", milestoneId)
        .single();

      if (!milestone) {
        return NextResponse.json(
          { error: "Milestone not found" },
          { status: 404 }
        );
      }

      if (milestone.engagements.client_id !== callerClient.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
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

      // Update milestone to released. Compare-and-swap on the releasable
      // states so a concurrent request or retry cannot pay out twice — the
      // second one affects 0 rows and returns 409 instead of transferring.
      const { data: releasedMilestone } = await admin
        .from("milestones")
        .update({
          status: "released",
          approved_at: milestone.approved_at || now,
          released_at: now,
        })
        .eq("id", milestoneId)
        .in("status", ["candidate_marked_complete", "approved"])
        .select("id")
        .maybeSingle();

      if (!releasedMilestone) {
        return NextResponse.json(
          { error: "Milestone is no longer in a releasable state" },
          { status: 409 }
        );
      }

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
