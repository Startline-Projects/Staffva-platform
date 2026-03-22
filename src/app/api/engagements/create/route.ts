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
 * POST /api/engagements/create
 *
 * Creates a new engagement between a client and candidate.
 *
 * Body for Ongoing Role:
 * { candidateId, contractType: "ongoing", paymentCycle: "weekly"|"biweekly"|"monthly", candidateRateUsd }
 *
 * Body for Project Milestone:
 * { candidateId, contractType: "project", candidateRateUsd, milestones: [{ title, description, amountUsd }] }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.user_metadata?.role !== "client") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await request.json();
    const { candidateId, contractType, paymentCycle, candidateRateUsd, milestones } = body;

    if (!candidateId || !contractType || !candidateRateUsd) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (contractType === "ongoing" && !paymentCycle) {
      return NextResponse.json({ error: "Payment cycle required for ongoing contracts" }, { status: 400 });
    }

    if (contractType === "project" && (!milestones || milestones.length === 0)) {
      return NextResponse.json({ error: "At least one milestone required for project contracts" }, { status: 400 });
    }

    const admin = getAdminClient();

    // Get client record
    const { data: client } = await admin
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Verify candidate is available
    const { data: candidate } = await admin
      .from("candidates")
      .select("id, lock_status, admin_status")
      .eq("id", candidateId)
      .single();

    if (!candidate || candidate.admin_status !== "approved") {
      return NextResponse.json({ error: "Candidate not available" }, { status: 400 });
    }

    if (candidate.lock_status === "locked") {
      return NextResponse.json({ error: "Candidate is currently engaged" }, { status: 400 });
    }

    // Calculate fees
    const rate = Number(candidateRateUsd);
    const platformFee = Math.round(rate * 0.1 * 100) / 100; // 10%
    const clientTotal = Math.round((rate + platformFee) * 100) / 100;

    // Create engagement
    const { data: engagement, error: engError } = await admin
      .from("engagements")
      .insert({
        client_id: client.id,
        candidate_id: candidateId,
        contract_type: contractType,
        payment_cycle: contractType === "ongoing" ? paymentCycle : null,
        candidate_rate_usd: rate,
        platform_fee_usd: platformFee,
        client_total_usd: clientTotal,
        status: "active",
        is_direct_contract: false,
      })
      .select()
      .single();

    if (engError || !engagement) {
      return NextResponse.json({ error: engError?.message || "Failed to create engagement" }, { status: 500 });
    }

    // For ongoing contracts, create the first payment period
    if (contractType === "ongoing") {
      const periodStart = new Date();
      const periodEnd = new Date();

      if (paymentCycle === "weekly") {
        periodEnd.setDate(periodEnd.getDate() + 7);
      } else if (paymentCycle === "biweekly") {
        periodEnd.setDate(periodEnd.getDate() + 14);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }

      await admin.from("payment_periods").insert({
        engagement_id: engagement.id,
        period_start: periodStart.toISOString().split("T")[0],
        period_end: periodEnd.toISOString().split("T")[0],
        amount_usd: rate,
      });
    }

    // For project contracts, create milestones
    if (contractType === "project" && milestones) {
      const milestoneRecords = milestones.map(
        (m: { title: string; description: string; amountUsd: number }) => ({
          engagement_id: engagement.id,
          title: m.title,
          description: m.description || null,
          amount_usd: m.amountUsd,
          status: "pending",
        })
      );

      await admin.from("milestones").insert(milestoneRecords);
    }

    return NextResponse.json({ engagement });
  } catch (error) {
    console.error("Create engagement error:", error);
    return NextResponse.json({ error: "Failed to create engagement" }, { status: 500 });
  }
}
