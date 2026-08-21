import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { generateContractHtml, generateSigningToken } from "@/lib/contracts";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/contracts/generate
 *
 * Generates an Independent Contractor Agreement for an engagement.
 * Body: { engagementId }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || user.app_metadata?.role !== "client") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { engagementId } = await request.json();
    if (!engagementId) {
      return NextResponse.json({ error: "Missing engagementId" }, { status: 400 });
    }

    const admin = getAdminClient();

    // Fetch engagement with client and candidate details
    const { data: engagement } = await admin
      .from("engagements")
      .select("*")
      .eq("id", engagementId)
      .single();

    if (!engagement) {
      return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
    }

    // Verify this client owns the engagement
    const { data: client } = await admin
      .from("clients")
      .select("id, full_name, company_name, email")
      .eq("user_id", user.id)
      .single();

    if (!client || client.id !== engagement.client_id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { data: candidate } = await admin
      .from("candidates")
      .select("id, display_name, full_name, role_category, hourly_rate")
      .eq("id", engagement.candidate_id)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    // Check if contract already exists for this engagement
    const { data: existing } = await admin
      .from("engagement_contracts")
      .select("id, status, contract_html")
      .eq("engagement_id", engagementId)
      .single();

    if (existing) {
      return NextResponse.json({
        contractId: existing.id,
        contractHtml: existing.contract_html,
        status: existing.status,
      });
    }

    // Generate contract HTML via Claude API
    const contractHtml = await generateContractHtml({
      clientLegalName: client.company_name || client.full_name,
      candidateDisplayName: candidate.display_name || candidate.full_name,
      roleCategory: candidate.role_category || "Professional Services",
      hourlyRate: Number(engagement.candidate_rate_usd) || candidate.hourly_rate,
      hoursPerWeek: engagement.weekly_hours || 40,
      paymentCycle: engagement.payment_cycle || "monthly",
      contractType: engagement.contract_type || "ongoing",
      startDate: new Date(engagement.created_at).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    });

    // Insert contract record
    const { data: contract, error: insertErr } = await admin
      .from("engagement_contracts")
      .insert({
        engagement_id: engagementId,
        candidate_id: candidate.id,
        client_id: client.id,
        contract_html: contractHtml,
        status: "pending_client",
      })
      .select()
      .single();

    if (insertErr || !contract) {
      return NextResponse.json(
        { error: insertErr?.message || "Failed to create contract" },
        { status: 500 }
      );
    }

    // Generate signing token for later candidate use
    const signingToken = generateSigningToken(contract.id);
    await admin
      .from("engagement_contracts")
      .update({ signing_token: signingToken })
      .eq("id", contract.id);

    return NextResponse.json({
      contractId: contract.id,
      contractHtml: contractHtml,
      status: "pending_client",
    });
  } catch (error) {
    console.error("Contract generation error:", error);
    return NextResponse.json({ error: "Failed to generate contract" }, { status: 500 });
  }
}
