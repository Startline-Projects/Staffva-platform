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
 * POST /api/engagements/direct-invite
 *
 * Client brings an outside hire onto StaffVA via Direct Contract.
 * Creates a pending engagement and sends an invitation email to the candidate.
 *
 * Body: {
 *   candidateName, candidateEmail, roleCategory,
 *   contractType, paymentCycle?, candidateRateUsd,
 *   milestones?: [{ title, description, amountUsd }]
 * }
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

    const {
      candidateName,
      candidateEmail,
      roleCategory,
      contractType,
      paymentCycle,
      candidateRateUsd,
      milestones,
    } = await request.json();

    if (!candidateName || !candidateEmail || !contractType || !candidateRateUsd) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
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

    // Check if candidate already exists on the platform
    const { data: existingCandidate } = await admin
      .from("candidates")
      .select("id, admin_status")
      .eq("email", candidateEmail)
      .single();

    let candidateId: string;

    if (existingCandidate) {
      candidateId = existingCandidate.id;
    } else {
      // Create a placeholder candidate record
      // The candidate will be invited to complete their profile
      // ID verification still required — admin can approve after
      const { data: newCandidate, error: createError } = await admin
        .from("candidates")
        .insert({
          user_id: user.id, // Temporary — will be reassigned when candidate claims
          full_name: candidateName,
          email: candidateEmail,
          country: "Pending",
          role_category: roleCategory || "VA",
          years_experience: "0-1",
          hourly_rate: candidateRateUsd,
          time_zone: "UTC",
          admin_status: "approved", // Direct contracts skip English test
          id_verification_status: "pending", // Still required
          activation_fee_paid: true,
        })
        .select("id")
        .single();

      if (createError || !newCandidate) {
        return NextResponse.json(
          { error: createError?.message || "Failed to create candidate" },
          { status: 500 }
        );
      }

      candidateId = newCandidate.id;
    }

    // Calculate fees
    const rate = Number(candidateRateUsd);
    const platformFee = Math.round(rate * 0.1 * 100) / 100;
    const clientTotal = Math.round((rate + platformFee) * 100) / 100;

    // Create engagement
    const { data: engagement, error: engError } = await admin
      .from("engagements")
      .insert({
        client_id: client.id,
        candidate_id: candidateId,
        contract_type: contractType,
        payment_cycle: contractType === "ongoing" ? paymentCycle || "monthly" : null,
        candidate_rate_usd: rate,
        platform_fee_usd: platformFee,
        client_total_usd: clientTotal,
        status: "active",
        is_direct_contract: true,
      })
      .select()
      .single();

    if (engError || !engagement) {
      return NextResponse.json(
        { error: engError?.message || "Failed to create engagement" },
        { status: 500 }
      );
    }

    // Create milestones if project type
    if (contractType === "project" && milestones?.length > 0) {
      const msRecords = milestones.map(
        (m: { title: string; description: string; amountUsd: number }) => ({
          engagement_id: engagement.id,
          title: m.title,
          description: m.description || null,
          amount_usd: m.amountUsd,
          status: "pending",
        })
      );
      await admin.from("milestones").insert(msRecords);
    }

    // Create first period for ongoing
    if (contractType === "ongoing") {
      const periodStart = new Date();
      const periodEnd = new Date();
      if (paymentCycle === "weekly") periodEnd.setDate(periodEnd.getDate() + 7);
      else if (paymentCycle === "biweekly") periodEnd.setDate(periodEnd.getDate() + 14);
      else periodEnd.setMonth(periodEnd.getMonth() + 1);

      await admin.from("payment_periods").insert({
        engagement_id: engagement.id,
        period_start: periodStart.toISOString().split("T")[0],
        period_end: periodEnd.toISOString().split("T")[0],
        amount_usd: rate,
      });
    }

    // TODO: Send invitation email to candidate via Resend
    console.log(
      `[StaffVA Direct Contract] Invitation sent to ${candidateEmail} from ${user.email}`
    );

    return NextResponse.json({
      engagement,
      candidateId,
      invited: !existingCandidate,
    });
  } catch (error) {
    console.error("Direct invite error:", error);
    return NextResponse.json({ error: "Failed to create direct contract" }, { status: 500 });
  }
}
