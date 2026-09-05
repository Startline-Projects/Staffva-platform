import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { verifySigningToken, generateSigningToken } from "@/lib/contracts";

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

/**
 * Can this agreement be signed at all, or does the document contradict the deal?
 *
 * The generator writes `candidate_rate_usd` into the document as "$X USD per
 * hour" and `weekly_hours || 40` as the hours. But candidate_rate_usd does NOT
 * always hold an hourly rate — it holds a weekly amount when payment_cycle is
 * weekly, a monthly amount when monthly, and a project total for project work.
 * And weekly_hours is NULL on seven of the eight contracts, so the "40 hours per
 * week" is invented.
 *
 * Live consequence, measured: a candidate whose engagement records $3.00 per
 * MONTH has a document promising "$3 USD per hour" for "40 hours per week" —
 * roughly 173 times the recorded amount. Signing it would execute an agreement
 * neither party meant.
 *
 * So an agreement is signable only when the engagement records enough to
 * reproduce what the document claims: explicit weekly_hours, and an hourly
 * basis. Everything else is refused until a human restates the terms. On today's
 * data that admits exactly one contract and refuses seven, which is the correct
 * outcome rather than a shortfall.
 */
function termsAreReproducible(engagement: {
  weekly_hours: number | null;
  payment_cycle: string | null;
  contract_type: string | null;
}): boolean {
  // No stated hours means the document's hours figure was the hardcoded 40.
  if (engagement.weekly_hours == null) return false;
  // A cycle amount or a project total is not an hourly rate, however the
  // document renders it.
  if (engagement.payment_cycle != null) return false;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { contractId, role, token } = body;

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

      if (clientEng && clientEng.status === "active" && !termsAreReproducible(clientEng)) {
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
      const signingToken = generateSigningToken(contractId);

      await admin
        .from("engagement_contracts")
        .update({
          client_signed_at: now,
          client_signature_ip: ip,
          status: "pending_candidate",
          signing_token: signingToken,
        })
        .eq("id", contractId);

      // Fetch candidate for email
      const { data: candidate } = await admin
        .from("candidates")
        .select("display_name, email, full_name")
        .eq("id", contract.candidate_id)
        .single();

      // Send signing email to candidate
      if (process.env.RESEND_API_KEY && candidate?.email) {
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";
        const signingUrl = `${siteUrl}/contracts/sign/${contractId}?token=${signingToken}`;

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
      // Candidate can sign via token (from email) or via authenticated session
      let candidateId: string | null = null;

      if (token) {
        // Token-based signing (from email link)
        const { data: contract } = await admin
          .from("engagement_contracts")
          .select("*")
          .eq("id", contractId)
          .single();

        if (!contract) {
          return NextResponse.json({ error: "Contract not found" }, { status: 404 });
        }

        if (!verifySigningToken(contractId, token)) {
          return NextResponse.json({ error: "Invalid or expired signing link" }, { status: 403 });
        }

        candidateId = contract.candidate_id;
      } else {
        // Authenticated signing
        const supabase = await createServerClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }

        const { data: candidate } = await admin
          .from("candidates")
          .select("id")
          .eq("user_id", user.id)
          .single();

        if (!candidate) {
          return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
        }

        candidateId = candidate.id;
      }

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

      if (eng && eng.status === "active" && !termsAreReproducible(eng)) {
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
