import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { termsAreReproducible } from "@/lib/contractTerms";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/contracts/sign
 *
 * Signs a contract as either client or candidate.
 * Body: { contractId, role: "client" | "candidate", token?: string }
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { contractId, role } = body;

    if (!contractId || !role) {
      return NextResponse.json({ error: "Missing contractId or role" }, { status: 400 });
    }

    const admin = getAdminClient();
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";

    // ═══ CLIENT SIGNING ═══
    if (role === "client") {
      const supabase = await createServerClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user || user.app_metadata?.role !== "client") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }

      // Get client record
      const { data: client } = await admin
        .from("clients")
        .select("id, full_name, email")
        .eq("user_id", user.id)
        .single();

      if (!client) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
      }

      // Fetch contract and verify ownership
      const { data: contract } = await admin
        .from("engagement_contracts")
        .select("*")
        .eq("id", contractId)
        .eq("client_id", client.id)
        .single();

      if (!contract) {
        return NextResponse.json({ error: "Contract not found" }, { status: 404 });
      }

      if (contract.status !== "pending_client") {
        return NextResponse.json({ error: `Contract is in ${contract.status} state` }, { status: 400 });
      }

      // Same gate as the candidate branch: the engagement must still be live.
      // Two pending_client contracts belong to engagements released in April,
      // so this side could execute a dead agreement too.
      const { data: clientEng } = await admin
        .from("engagements")
        .select("status, weekly_hours, payment_cycle, contract_type")
        .eq("id", contract.engagement_id)
        .maybeSingle();

      if (clientEng && clientEng.status === "active" && !termsAreReproducible({ weeklyHours: clientEng.weekly_hours, paymentCycle: clientEng.payment_cycle })) {
        return NextResponse.json(
          {
            error:
              "The pay terms in this agreement don't match the engagement record, so it can't be countersigned. Please re-issue it with the correct terms.",
            code: "terms_conflict",
          },
          { status: 409 }
        );
      }

      if (!clientEng || clientEng.status !== "active") {
        return NextResponse.json(
          { error: "This engagement has ended, so its agreement can no longer be signed." },
          { status: 409 }
        );
      }

      // Record client signature
      const now = new Date().toISOString();

      // Compare-and-swap, mirroring the candidate branch: two tabs must not
      // both countersign.
      const { data: countersigned } = await admin
        .from("engagement_contracts")
        .update({
          client_signed_at: now,
          client_signature_ip: ip,
          status: "pending_candidate",
        })
        .eq("id", contractId)
        .eq("status", "pending_client")
        .select("id")
        .maybeSingle();

      if (!countersigned) {
        return NextResponse.json(
          { error: "This agreement was already countersigned." },
          { status: 409 }
        );
      }

      // Fetch candidate for email
      const { data: candidate } = await admin
        .from("candidates")
        .select("display_name, email, full_name")
        .eq("id", contract.candidate_id)
        .single();

      // Send signing email to candidate
      if (process.env.RESEND_API_KEY && candidate?.email) {
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";
        // Points at the authenticated record page. The ?token URL it used to
        // carry authenticated by a forgeable HMAC; the page is now a redirect
        // that drops the query string anyway. (This send is suppressed by the
        // candidate email freeze regardless — it is fixed so it is not waiting
        // to be wrong when the freeze lifts.)
        const signingUrl = `${siteUrl}/candidate/contracts/${contractId}`;

        try {
          await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: candidate.email,
            subject: "Contract ready for your signature — StaffVA",
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Your contract is ready to sign</h2>
              <p style="color:#444;font-size:14px;">${client.full_name} has signed the Independent Contractor Agreement for your engagement on StaffVA. Please review and sign the contract to finalize the engagement.</p>
              <div style="background:#f9f9f9;border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin:16px 0;">
                <p style="margin:0;font-size:14px;color:#666;">Review the full contract and add your signature to begin work.</p>
              </div>
              <a href="${signingUrl}" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Review & Sign Contract</a>
              <p style="color:#999;margin-top:24px;font-size:12px;">This link expires in 7 days. — The StaffVA Team</p>
            </div>`,
          }, { recipientKind: "candidate", emailType: "contract_ready_to_sign" });
        } catch { /* silent */ }
      }

      return NextResponse.json({ success: true, status: "pending_candidate" });
    }

    // ═══ CANDIDATE SIGNING ═══
    if (role === "candidate") {
      // Signing is authenticated, full stop.
      //
      // The token alternative is deleted. verifySigningToken checked an HMAC
      // whose key falls back to a literal committed to this repo when
      // CONTRACT_SIGNING_SECRET is unset — and it is absent from .env.local —
      // and the "7-day expiry" read the timestamp out of the token itself, which
      // the caller supplies. Anyone with a contract UUID could therefore have
      // executed a legally binding agreement as the contractor, with no session.
      //
      // It also never consulted engagement_contracts.signing_token, so that
      // column revokes nothing. No caller has ever sent a token: ContractRecord
      // and ContractReviewModal both send none, and the only URL that carried
      // one went by candidate email, which is frozen.
      //
      // Sequencing matters here. Unauthenticated execution was, until this
      // change, held back only by the terms-conflict gate — so restating the
      // pay terms (the intended next step) would have re-armed it. This closes
      // that before the terms are fixed, not after.
      const supabase = await createServerClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      }

      // Signed in is not the same as being the contractor.
      //
      // The client branch checks app_metadata.role; this one checked only that
      // somebody was logged in and then resolved identity through
      // candidates.user_id with the service role, so RLS could not backstop it.
      // That matters because /api/engagements/direct-invite writes the INVITING
      // CLIENT's auth id onto a placeholder candidates row — commented
      // "Temporary — will be reassigned when candidate claims", and nothing
      // anywhere ever reassigns it. Without this check that client satisfies
      // both branches and can execute both halves of their own agreement.
      if (user.app_metadata?.role !== "candidate") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }

      const { data: signer } = await admin
        .from("candidates")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!signer) {
        return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
      }

      const candidateId: string = signer.id;

      // Fetch contract and verify candidate
      const { data: contract } = await admin
        .from("engagement_contracts")
        .select("*")
        .eq("id", contractId)
        .eq("candidate_id", candidateId)
        .single();

      if (!contract) {
        return NextResponse.json({ error: "Contract not found" }, { status: 404 });
      }

      if (contract.status !== "pending_candidate") {
        return NextResponse.json({ error: `Contract is in ${contract.status} state` }, { status: 400 });
      }

      // The ENGAGEMENT must still be live.
      //
      // This checked contract.status alone, and nothing else in the pipeline
      // checked either — so a candidate whose engagement was released in April
      // could log in today and legally execute the agreement for it. That is
      // not hypothetical: two such contracts are live right now, on engagements
      // released on 15 and 17 April, and the dashboard renders a "Review & Sign"
      // control for both.
      const { data: eng } = await admin
        .from("engagements")
        .select("status, weekly_hours, payment_cycle, contract_type")
        .eq("id", contract.engagement_id)
        .maybeSingle();

      if (eng && eng.status === "active" && !termsAreReproducible({ weeklyHours: eng.weekly_hours, paymentCycle: eng.payment_cycle })) {
        return NextResponse.json(
          {
            error:
              "The pay terms in this agreement don't match your engagement, so it can't be signed yet. We've flagged it for review — nothing you need to do.",
            code: "terms_conflict",
          },
          { status: 409 }
        );
      }

      if (!eng || eng.status !== "active") {
        return NextResponse.json(
          {
            error:
              "This engagement has ended, so its agreement can no longer be signed. Contact support if you think that's wrong.",
          },
          { status: 409 }
        );
      }

      // Record candidate signature. Compare-and-swap on the status we checked,
      // so two tabs cannot both execute it.
      const now = new Date().toISOString();
      const { data: signed } = await admin
        .from("engagement_contracts")
        .update({
          candidate_signed_at: now,
          candidate_signature_ip: ip,
          status: "fully_executed",
        })
        .eq("id", contractId)
        .eq("status", "pending_candidate")
        .select("id")
        .maybeSingle();

      if (!signed) {
        return NextResponse.json(
          { error: "This agreement was already signed." },
          { status: 409 }
        );
      }

      // Trigger PDF generation asynchronously
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      try {
        fetch(`${siteUrl}/api/contracts/generate-pdf`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Internal server-to-server call — authenticate to the now-gated route.
            authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`,
          },
          body: JSON.stringify({ contractId }),
        }).catch(() => {});
      } catch { /* fire and forget */ }

      return NextResponse.json({ success: true, status: "fully_executed" });
    }

    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  } catch (error) {
    console.error("Contract sign error:", error);
    return NextResponse.json({ error: "Failed to sign contract" }, { status: 500 });
  }
}
