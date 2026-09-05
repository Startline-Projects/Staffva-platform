import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET /api/contracts/view?contractId=X&token=Y
 *
 * Returns contract HTML for viewing. Validates via token or authenticated session.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get("contractId");

    if (!contractId) {
      return NextResponse.json({ error: "Missing contractId" }, { status: 400 });
    }

    const admin = getAdminClient();

    // Fetch contract
    const { data: contract } = await admin
      .from("engagement_contracts")
      .select("*, clients(full_name, company_name), candidates(display_name, full_name)")
      .eq("id", contractId)
      .single();

    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    // Authorize: authenticated, and a party to this contract.
    //
    // The ?token alternative is gone. verifySigningToken checked an HMAC whose
    // key falls back to a literal committed to this repo when
    // CONTRACT_SIGNING_SECRET is unset — and it is not set in .env.local — while
    // the "7-day expiry" was computed from the timestamp inside the token, which
    // the caller chooses. So anyone holding a contract UUID could mint a valid
    // token and read the full agreement, both parties' legal names, the
    // signature timestamps and a year-long signed PDF URL, with no session.
    //
    // It also never consulted engagement_contracts.signing_token, so that column
    // is decorative: overwriting it revokes nothing. No caller has ever passed a
    // token — team/page.tsx sends none, and the only URL that carried one was in
    // an email to candidates, which is frozen and now points at a redirect that
    // drops the query string. Deleting beats hardening a dead path.
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: client } = await admin.from("clients").select("id").eq("user_id", user.id).single();
    const { data: candidate } = await admin.from("candidates").select("id").eq("user_id", user.id).single();

    if (client?.id !== contract.client_id && candidate?.id !== contract.candidate_id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const clientInfo = contract.clients as { full_name: string; company_name: string | null } | null;
    const candidateInfo = contract.candidates as { display_name: string; full_name: string } | null;

    return NextResponse.json({
      contractId: contract.id,
      contractHtml: contract.contract_html,
      status: contract.status,
      clientName: clientInfo?.company_name || clientInfo?.full_name || "Client",
      candidateName: candidateInfo?.display_name || candidateInfo?.full_name || "Contractor",
      clientSignedAt: contract.client_signed_at,
      candidateSignedAt: contract.candidate_signed_at,
      generatedAt: contract.generated_at,
      contractPdfUrl: contract.contract_pdf_url,
    });
  } catch (error) {
    console.error("Contract view error:", error);
    return NextResponse.json({ error: "Failed to load contract" }, { status: 500 });
  }
}
