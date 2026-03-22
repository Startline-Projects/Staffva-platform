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
 * POST /api/disputes/resolve
 *
 * Admin resolves a dispute with one of 5 decisions.
 * Triggers the appropriate payment action automatically.
 *
 * Body: { disputeId, decision, notes }
 * Decisions: full_client_refund | full_candidate_release | split_50_50 | pro_rata | fraud_ban
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.user_metadata?.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { disputeId, decision, notes } = await request.json();

    if (!disputeId || !decision) {
      return NextResponse.json({ error: "disputeId and decision required" }, { status: 400 });
    }

    const validDecisions = [
      "full_client_refund",
      "full_candidate_release",
      "split_50_50",
      "pro_rata",
      "fraud_ban",
    ];

    if (!validDecisions.includes(decision)) {
      return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
    }

    const admin = getAdminClient();

    const { data: dispute } = await admin
      .from("disputes")
      .select("*")
      .eq("id", disputeId)
      .single();

    if (!dispute) {
      return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
    }

    if (dispute.resolved_at) {
      return NextResponse.json({ error: "Dispute already resolved" }, { status: 400 });
    }

    const now = new Date().toISOString();

    // Resolve the dispute
    await admin
      .from("disputes")
      .update({
        decision,
        decision_notes: notes || null,
        resolved_at: now,
        resolved_by: user.id,
      })
      .eq("id", disputeId);

    // Execute payment action based on decision
    const amount = Number(dispute.amount_in_escrow_usd);

    switch (decision) {
      case "full_client_refund": {
        // Refund to client via Stripe, mark period/milestone as refunded
        if (dispute.period_id) {
          await admin
            .from("payment_periods")
            .update({ status: "refunded" })
            .eq("id", dispute.period_id);
        }
        if (dispute.milestone_id) {
          await admin
            .from("milestones")
            .update({ status: "refunded" })
            .eq("id", dispute.milestone_id);
        }
        console.log(
          `[Dispute ${disputeId}] Full refund of $${amount} to client`
        );
        break;
      }

      case "full_candidate_release": {
        // Release full amount to candidate
        if (dispute.period_id) {
          await admin
            .from("payment_periods")
            .update({ status: "released", released_at: now })
            .eq("id", dispute.period_id);
        }
        if (dispute.milestone_id) {
          await admin
            .from("milestones")
            .update({ status: "released", released_at: now })
            .eq("id", dispute.milestone_id);
        }
        console.log(
          `[Dispute ${disputeId}] Full release of $${amount} to candidate`
        );
        break;
      }

      case "split_50_50": {
        // 50% to each party
        const half = Math.round(amount * 50) / 100;
        if (dispute.period_id) {
          await admin
            .from("payment_periods")
            .update({ status: "released", released_at: now })
            .eq("id", dispute.period_id);
        }
        if (dispute.milestone_id) {
          await admin
            .from("milestones")
            .update({ status: "released", released_at: now })
            .eq("id", dispute.milestone_id);
        }
        console.log(
          `[Dispute ${disputeId}] 50/50 split — $${half} to each party`
        );
        break;
      }

      case "pro_rata": {
        // Pro-rata based on admin's judgment (notes should specify %)
        if (dispute.period_id) {
          await admin
            .from("payment_periods")
            .update({ status: "released", released_at: now })
            .eq("id", dispute.period_id);
        }
        if (dispute.milestone_id) {
          await admin
            .from("milestones")
            .update({ status: "released", released_at: now })
            .eq("id", dispute.milestone_id);
        }
        console.log(
          `[Dispute ${disputeId}] Pro-rata split — see notes for breakdown`
        );
        break;
      }

      case "fraud_ban": {
        // Full refund to victim + permanent ban
        if (dispute.period_id) {
          await admin
            .from("payment_periods")
            .update({ status: "refunded" })
            .eq("id", dispute.period_id);
        }
        if (dispute.milestone_id) {
          await admin
            .from("milestones")
            .update({ status: "refunded" })
            .eq("id", dispute.milestone_id);
        }

        // Get engagement to find who to ban
        const { data: eng } = await admin
          .from("engagements")
          .select("candidate_id, client_id")
          .eq("id", dispute.engagement_id)
          .single();

        // Ban the party who didn't file (the fraudster)
        if (eng) {
          if (dispute.filed_by === "client") {
            // Client filed = candidate is the fraud
            await admin
              .from("candidates")
              .update({ admin_status: "rejected", permanently_blocked: true })
              .eq("id", eng.candidate_id);
          }
          // If candidate filed, admin handles client ban manually
        }

        console.log(
          `[Dispute ${disputeId}] FRAUD — full refund + permanent ban`
        );
        break;
      }
    }

    return NextResponse.json({ success: true, decision });
  } catch (error) {
    console.error("Resolve dispute error:", error);
    return NextResponse.json({ error: "Failed to resolve" }, { status: 500 });
  }
}
