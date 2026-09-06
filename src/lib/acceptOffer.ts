import type { SupabaseClient } from "@supabase/supabase-js";
import { generateContractHtml } from "@/lib/contracts";
import { sendEmail } from "@/lib/email";
import { notifyCandidate } from "@/lib/notifyCandidate";

/**
 * Everything that happens when an offer's CURRENT terms are accepted —
 * engagement, contract, and the tell-the-other-side notifications.
 *
 * Extracted from the candidate respond branch so that negotiation can call
 * it from either side: after a candidate counter, it is the CLIENT who
 * accepts, and the effects must be identical. The offer envelope holds the
 * current terms (each counter rewrites them), so acceptance after three
 * rounds builds the engagement and the contract from the last counter with
 * no special-casing here.
 */
export interface OfferForAccept {
  id: string;
  client_id: string;
  candidate_id: string;
  hourly_rate: number;
  hours_per_week: number;
  contract_length: string;
  start_date: string | null;
  estimated_monthly_cost: number;
}

export async function executeOfferAccept(
  admin: SupabaseClient,
  offer: OfferForAccept,
  acceptedBy: "client" | "candidate"
): Promise<void> {
  const { data: engagement, error: engErr } = await admin.from("engagements").insert({
    client_id: offer.client_id,
    candidate_id: offer.candidate_id,
    contract_type: offer.contract_length === "Ongoing" ? "ongoing" : "project",
    candidate_rate_usd: offer.hourly_rate,
    platform_fee_usd: Number(offer.hourly_rate) * offer.hours_per_week * 4.33 * 0.10,
    client_total_usd: Number(offer.estimated_monthly_cost),
    weekly_hours: offer.hours_per_week,
    status: "active",
  }).select().single();

  // The offer is already flipped to 'accepted' by the caller's CAS. Failing
  // to build the engagement and returning as if nothing happened is the
  // swallow-and-continue pattern: both parties see "accepted", nobody gets a
  // contract, and no log names the corpse. Throw — the route 500s and the
  // person who clicked knows to reach out instead of waiting for a contract
  // that will never come.
  if (engErr || !engagement) {
    throw new Error(`engagement insert on offer accept failed: ${engErr?.message ?? "no row returned"}`);
  }

  try {
    const { data: clientInfo } = await admin
      .from("clients").select("full_name, company_name, email").eq("id", offer.client_id).single();
    const { data: candInfo } = await admin
      .from("candidates").select("display_name, full_name, role_category, hourly_rate").eq("id", offer.candidate_id).single();

    const contractHtml = await generateContractHtml({
      clientLegalName: clientInfo?.company_name || clientInfo?.full_name || "Client",
      candidateDisplayName: candInfo?.display_name || candInfo?.full_name || "Contractor",
      roleCategory: candInfo?.role_category || "Professional Services",
      hourlyRate: Number(offer.hourly_rate),
      hoursPerWeek: offer.hours_per_week || 40,
      paymentCycle: "monthly",
      contractType: offer.contract_length === "Ongoing" ? "ongoing" : "project",
      startDate: offer.start_date
        ? new Date(offer.start_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
        : new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    });

    await admin.from("engagement_contracts").insert({
      engagement_id: engagement.id,
      candidate_id: offer.candidate_id,
      client_id: offer.client_id,
      contract_html: contractHtml,
      status: "pending_client",
    });

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";

    // The party who did NOT click accept is the one who needs to hear it.
    if (acceptedBy === "candidate") {
      if (process.env.RESEND_API_KEY && clientInfo?.email) {
        try {
          await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: clientInfo.email,
            subject: `${candInfo?.display_name || "A candidate"} accepted your offer — Contract ready for signing`,
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Offer Accepted!</h2>
              <p style="color:#444;font-size:14px;">${candInfo?.display_name || "The candidate"} has accepted your offer. An Independent Contractor Agreement has been generated and is ready for your review and signature.</p>
              <p style="color:#444;font-size:14px;">Please sign the contract so it can be sent to the contractor for their signature. Escrow funding will become available once both parties sign.</p>
              <a href="${siteUrl}/team" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Review & Sign Contract</a>
              <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
            </div>`,
          }, { recipientKind: "client", emailType: "offer_response" });
        } catch { /* silent */ }
      }
    } else {
      // Client accepted the candidate's counter — the candidate hears via the
      // bell (their email is frozen), at the terms THEY proposed.
      await notifyCandidate(admin, {
        candidateId: offer.candidate_id,
        category: "offer",
        title: "Your counter-offer was accepted",
        body: `$${offer.hourly_rate}/hr · ${offer.hours_per_week} hrs/week. A contract is being drawn up — it reaches you after the client signs.`,
        route: "/candidate/work",
        dedupeKey: `counter-accepted-${offer.id}`,
      });
    }
  } catch (contractErr) {
    console.error("Contract generation on offer accept failed:", contractErr);
  }
}
