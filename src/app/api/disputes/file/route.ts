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
 * POST /api/disputes/file
 *
 * Either party files a dispute within 48 hours of period end or milestone completion.
 *
 * Body: { engagementId, periodId?, milestoneId?, statement, evidenceUrl? }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { engagementId, periodId, milestoneId, statement, evidenceUrl } =
      await request.json();
    const role = user.user_metadata?.role;

    if (!engagementId || !statement) {
      return NextResponse.json(
        { error: "engagementId and statement required" },
        { status: 400 }
      );
    }

    if (!periodId && !milestoneId) {
      return NextResponse.json(
        { error: "periodId or milestoneId required" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();

    // Verify engagement exists and user is a party
    const { data: engagement } = await admin
      .from("engagements")
      .select("id, client_id, candidate_id")
      .eq("id", engagementId)
      .single();

    if (!engagement) {
      return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
    }

    // Verify the filer is part of this engagement
    let filedBy: "client" | "candidate";

    if (role === "client") {
      const { data: client } = await admin
        .from("clients")
        .select("id")
        .eq("user_id", user.id)
        .single();
      if (!client || client.id !== engagement.client_id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
      filedBy = "client";
    } else if (role === "candidate") {
      const { data: candidate } = await admin
        .from("candidates")
        .select("id")
        .eq("user_id", user.id)
        .single();
      if (!candidate || candidate.id !== engagement.candidate_id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
      filedBy = "candidate";
    } else {
      return NextResponse.json({ error: "Invalid role" }, { status: 403 });
    }

    // Check 48-hour window
    if (periodId) {
      const { data: period } = await admin
        .from("payment_periods")
        .select("period_end, status")
        .eq("id", periodId)
        .single();

      if (!period) {
        return NextResponse.json({ error: "Period not found" }, { status: 404 });
      }

      if (period.status === "released") {
        return NextResponse.json(
          { error: "Funds already released — dispute window closed" },
          { status: 400 }
        );
      }

      const periodEnd = new Date(period.period_end);
      const windowClose = new Date(periodEnd.getTime() + 48 * 60 * 60 * 1000);
      if (new Date() > windowClose) {
        return NextResponse.json(
          { error: "48-hour dispute window has closed" },
          { status: 400 }
        );
      }
    }

    if (milestoneId) {
      const { data: milestone } = await admin
        .from("milestones")
        .select("marked_complete_at, status")
        .eq("id", milestoneId)
        .single();

      if (!milestone) {
        return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
      }

      if (milestone.status === "released") {
        return NextResponse.json(
          { error: "Funds already released — dispute window closed" },
          { status: 400 }
        );
      }

      if (milestone.marked_complete_at) {
        const markedAt = new Date(milestone.marked_complete_at);
        const windowClose = new Date(markedAt.getTime() + 48 * 60 * 60 * 1000);
        if (new Date() > windowClose) {
          return NextResponse.json(
            { error: "48-hour dispute window has closed" },
            { status: 400 }
          );
        }
      }
    }

    // Check for existing active dispute
    const existingFilter = admin
      .from("disputes")
      .select("id", { count: "exact", head: true })
      .eq("engagement_id", engagementId)
      .is("resolved_at", null);

    if (periodId) existingFilter.eq("period_id", periodId);
    if (milestoneId) existingFilter.eq("milestone_id", milestoneId);

    const { count } = await existingFilter;
    if (count && count > 0) {
      return NextResponse.json(
        { error: "A dispute is already open for this item" },
        { status: 400 }
      );
    }

    // Determine amount in escrow
    let amountInEscrow = 0;
    if (periodId) {
      const { data: p } = await admin
        .from("payment_periods")
        .select("amount_usd")
        .eq("id", periodId)
        .single();
      amountInEscrow = Number(p?.amount_usd) || 0;

      // Mark period as disputed
      await admin
        .from("payment_periods")
        .update({ status: "disputed", dispute_filed_at: new Date().toISOString() })
        .eq("id", periodId);
    }

    if (milestoneId) {
      const { data: m } = await admin
        .from("milestones")
        .select("amount_usd")
        .eq("id", milestoneId)
        .single();
      amountInEscrow = Number(m?.amount_usd) || 0;

      // Mark milestone as disputed
      await admin
        .from("milestones")
        .update({ status: "disputed" })
        .eq("id", milestoneId);
    }

    // Create dispute
    const disputeData: Record<string, unknown> = {
      engagement_id: engagementId,
      filed_by: filedBy,
      amount_in_escrow_usd: amountInEscrow,
    };

    if (periodId) disputeData.period_id = periodId;
    if (milestoneId) disputeData.milestone_id = milestoneId;

    if (filedBy === "client") {
      disputeData.client_statement = statement;
      disputeData.client_evidence_url = evidenceUrl || null;
    } else {
      disputeData.candidate_statement = statement;
      disputeData.candidate_evidence_url = evidenceUrl || null;
    }

    const { data: dispute, error: insertError } = await admin
      .from("disputes")
      .insert(disputeData)
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ dispute });
  } catch (error) {
    console.error("File dispute error:", error);
    return NextResponse.json({ error: "Failed to file dispute" }, { status: 500 });
  }
}
