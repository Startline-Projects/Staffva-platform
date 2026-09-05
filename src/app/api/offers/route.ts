import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { generateContractHtml, generateSigningToken } from "@/lib/contracts";
import { extractText } from "@/lib/anthropic";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Client-typed text goes into the candidate's email verbatim — escape it so
// a crafted message can't inject markup into someone else's inbox.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// GET — list offers for current user (client or candidate)
export async function GET() {
  const serverSupabase = await createServerClient();
  const { data: { user } } = await serverSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabase = getAdminClient();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  if (profile?.role === "client") {
    const { data: client } = await supabase.from("clients").select("id").eq("user_id", user.id).single();
    if (!client) return NextResponse.json({ offers: [] });

    const { data } = await supabase
      .from("engagement_offers")
      .select("*, candidates(display_name, full_name, country, role_category, profile_photo_url)")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false });

    return NextResponse.json({ offers: data || [] });
  }

  if (profile?.role === "candidate") {
    const { data: candidate } = await supabase.from("candidates").select("id").eq("user_id", user.id).single();
    if (!candidate) return NextResponse.json({ offers: [] });

    const { data } = await supabase
      .from("engagement_offers")
      .select("*, clients(full_name, company_name)")
      .eq("candidate_id", candidate.id)
      // `expired` included: with candidate mail frozen, the likeliest thing to
      // happen to an offer is that it times out unseen, and dropping it here
      // would erase the evidence the candidate was ever offered work.
      .in("status", ["sent", "viewed", "accepted", "declined", "expired"])
      .order("sent_at", { ascending: false });

    return NextResponse.json({ offers: data || [] });
  }

  return NextResponse.json({ offers: [] });
}

// POST — create + send offer, generate AI message, respond to offer
export async function POST(req: NextRequest) {
  const serverSupabase = await createServerClient();
  const { data: { user } } = await serverSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabase = getAdminClient();
  const body = await req.json();
  const { action } = body;

  // ═══ Generate AI message ═══
  if (action === "generate_message") {
    // Reachable by any authenticated user, and it makes a paid model call.
    // Keyed on the user id, which is unforgeable.
    const limited = await enforceRateLimit(`offer-message:${user.id}`, LIMITS.offerMessage);
    if (limited) return limited;

    const { candidateId } = body;
    if (!candidateId) return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });

    const { data: candidate } = await supabase
      .from("candidates")
      .select("display_name, role_category, skills, tools")
      .eq("id", candidateId)
      .single();

    if (!candidate) return NextResponse.json({ message: "" });

    // (The old candidate_interviews scores are retired; the message is
    // grounded in the profile alone.)
    const interviewNote = "";

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ message: `Hi ${candidate.display_name?.split(" ")[0]}, I was impressed by your profile and would love to work with you on our team. Your experience in ${candidate.role_category} is exactly what we're looking for.` });
    }

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 150,
          messages: [{ role: "user", content: `Generate a warm professional 3-sentence offer message from a client to a candidate named ${candidate.display_name} who is a ${candidate.role_category}. Their key skills are: ${(candidate.skills || []).slice(0, 5).join(", ")}. ${interviewNote} Return only the message text, no quotes.` }],
        }),
      });

      const data = await res.json();
      const message = extractText(data) || `Hi ${candidate.display_name?.split(" ")[0]}, your profile stood out to us. We'd love to discuss working together.`;
      return NextResponse.json({ message });
    } catch {
      return NextResponse.json({ message: `Hi ${candidate.display_name?.split(" ")[0]}, your profile stood out to us and we'd love to discuss working together.` });
    }
  }

  // ═══ Send offer ═══
  if (action === "send_offer") {
    const { candidateId, hourlyRate, hoursPerWeek, contractLength, startDate, signingBonus, personalMessage } = body;

    const { data: client } = await supabase.from("clients").select("id, full_name, company_name").eq("user_id", user.id).single();
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const { data: candidate } = await supabase.from("candidates").select("id, email, display_name, full_name, hourly_rate, role_category").eq("id", candidateId).single();
    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    // One live offer per pair. The friendly refusal; the partial unique
    // index (00136) is the backstop that closes the concurrent-send race.
    const { data: existing } = await supabase
      .from("engagement_offers")
      .select("id")
      .eq("client_id", client.id)
      .eq("candidate_id", candidateId)
      .in("status", ["sent", "viewed"])
      .limit(1)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: "You already have a pending offer with this candidate.", offerId: existing.id },
        { status: 409 }
      );
    }

    const monthlyEquiv = hourlyRate * hoursPerWeek * 4.33;
    const platformFee = monthlyEquiv * 0.10;
    const clientMonthly = monthlyEquiv + platformFee;

    const lengthMonths: Record<string, number> = { "1 month": 1, "3 months": 3, "6 months": 6, "12 months": 12, "Ongoing": 12 };
    const months = lengthMonths[contractLength] || 12;
    const contractTotal = clientMonthly * months;

    let comparison: "above" | "at" | "below" = "at";
    if (hourlyRate > Number(candidate.hourly_rate)) comparison = "above";
    else if (hourlyRate < Number(candidate.hourly_rate)) comparison = "below";

    const { data: offer, error: insertErr } = await supabase.from("engagement_offers").insert({
      candidate_id: candidateId,
      client_id: client.id,
      hourly_rate: hourlyRate,
      hours_per_week: hoursPerWeek,
      contract_length: contractLength,
      start_date: startDate,
      signing_bonus_usd: signingBonus || null,
      personal_message: personalMessage || null,
      estimated_monthly_cost: clientMonthly,
      estimated_contract_total: contractTotal,
      candidate_rate_comparison: comparison,
      status: "sent",
      sent_at: new Date().toISOString(),
    }).select().single();

    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

    // Send email to candidate
    if (process.env.RESEND_API_KEY && candidate.email) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";
      const expiryDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

      try {
        await sendEmail({
          from: "StaffVA <notifications@staffva.com>",
          to: candidate.email,
          subject: "You have received an offer on StaffVA",
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">You've received an offer</h2>
            <p style="color:#444;font-size:14px;">${client.full_name}${client.company_name ? ` from ${client.company_name}` : ""} has sent you an offer for <strong>${candidate.role_category}</strong>.</p>
            <div style="background:#f9f9f9;border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin:16px 0;">
              <p style="margin:0 0 8px;font-size:14px;"><strong>Rate:</strong> $${hourlyRate}/hr</p>
              <p style="margin:0 0 8px;font-size:14px;"><strong>Hours:</strong> ${hoursPerWeek}/week</p>
              <p style="margin:0 0 8px;font-size:14px;"><strong>Start:</strong> ${new Date(startDate).toLocaleDateString("en-US", { timeZone: "UTC" })}</p>
              <p style="margin:0;font-size:14px;"><strong>Length:</strong> ${contractLength}</p>
            </div>
            ${personalMessage ? `<div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:8px;padding:16px;margin:16px 0;"><p style="margin:0;font-size:13px;color:#9A3412;font-style:italic;">"${escapeHtml(personalMessage)}"</p></div>` : ""}
            <p style="color:#444;font-size:14px;">View and respond to this offer by <strong>${expiryDate}</strong>.</p>
            <a href="${siteUrl}/offers/${offer.id}" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">View Offer</a>
            <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
          </div>`,
        }, { recipientKind: "candidate", emailType: "offer_received" });
      } catch { /* silent */ }
    }

    return NextResponse.json({ offer });
  }

  // ═══ Respond to offer (candidate) ═══
  if (action === "respond") {
    const { offerId, response } = body; // response: "accept" or "decline"

    const { data: candidate } = await supabase.from("candidates").select("id").eq("user_id", user.id).single();
    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    const { data: offer } = await supabase.from("engagement_offers").select("*, clients(full_name, email)").eq("id", offerId).eq("candidate_id", candidate.id).single();
    if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });

    if (response === "accept") {
      // Compare-and-set: only an open offer can transition, and every side
      // effect below (engagement, contract, email) runs ONLY when this
      // request is the one that transitioned it — a second accept from a
      // stale tab, or an accept of an expired offer, does nothing.
      const { data: transitioned } = await supabase
        .from("engagement_offers")
        .update({ status: "accepted", responded_at: new Date().toISOString() })
        .eq("id", offerId)
        .in("status", ["sent", "viewed"])
        .select("id");
      if (!transitioned?.length) {
        return NextResponse.json({ error: "This offer is no longer open." }, { status: 409 });
      }

      // Create engagement from offer terms
      const { data: engagement } = await supabase.from("engagements").insert({
        client_id: offer.client_id,
        candidate_id: offer.candidate_id,
        contract_type: offer.contract_length === "Ongoing" ? "ongoing" : "project",
        candidate_rate_usd: offer.hourly_rate,
        platform_fee_usd: Number(offer.hourly_rate) * offer.hours_per_week * 4.33 * 0.10,
        client_total_usd: Number(offer.estimated_monthly_cost),
        weekly_hours: offer.hours_per_week,
        status: "active",
      }).select().single();

      // Generate contract for the new engagement
      if (engagement) {
        try {
          const { data: clientInfo } = await supabase.from("clients").select("full_name, company_name, email").eq("id", offer.client_id).single();
          const { data: candInfo } = await supabase.from("candidates").select("display_name, full_name, role_category, hourly_rate").eq("id", offer.candidate_id).single();

          const contractHtml = await generateContractHtml({
            clientLegalName: clientInfo?.company_name || clientInfo?.full_name || "Client",
            candidateDisplayName: candInfo?.display_name || candInfo?.full_name || "Contractor",
            roleCategory: candInfo?.role_category || "Professional Services",
            hourlyRate: Number(offer.hourly_rate),
            hoursPerWeek: offer.hours_per_week || 40,
            paymentCycle: "monthly",
            contractType: offer.contract_length === "Ongoing" ? "ongoing" : "project",
            startDate: offer.start_date ? new Date(offer.start_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
          });

          const { data: contract } = await supabase.from("engagement_contracts").insert({
            engagement_id: engagement.id,
            candidate_id: offer.candidate_id,
            client_id: offer.client_id,
            contract_html: contractHtml,
            status: "pending_client",
          }).select().single();

          if (contract) {
            const signingToken = generateSigningToken(contract.id);
            await supabase.from("engagement_contracts").update({ signing_token: signingToken }).eq("id", contract.id);

            // Email client to review and sign contract
            if (process.env.RESEND_API_KEY && clientInfo?.email) {
              const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";
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
          }
        } catch (contractErr) {
          console.error("Contract generation on offer accept failed:", contractErr);
        }
      }

      return NextResponse.json({ success: true, status: "accepted" });
    }

    if (response === "decline") {
      const { data: transitioned } = await supabase
        .from("engagement_offers")
        .update({ status: "declined", responded_at: new Date().toISOString() })
        .eq("id", offerId)
        .in("status", ["sent", "viewed"])
        .select("id");
      if (!transitioned?.length) {
        return NextResponse.json({ error: "This offer is no longer open." }, { status: 409 });
      }

      // Notify client
      const clientInfo = offer.clients as { full_name: string; email: string } | null;
      if (process.env.RESEND_API_KEY && clientInfo?.email) {
        const { data: cand } = await supabase.from("candidates").select("display_name").eq("id", candidate.id).single();
        try {
          await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: clientInfo.email,
            subject: `${cand?.display_name || "A candidate"} has declined your offer`,
            html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Offer Declined</h2>
              <p style="color:#444;font-size:14px;">${cand?.display_name || "The candidate"} has declined your offer. You may send a revised offer or browse other candidates.</p>
              <a href="https://staffva.com/browse" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Browse Talent</a>
            </div>`,
          }, { recipientKind: "client", emailType: "offer_response" });
        } catch { /* silent */ }
      }

      return NextResponse.json({ success: true, status: "declined" });
    }

    return NextResponse.json({ error: "Invalid response" }, { status: 400 });
  }

  // ═══ Mark as viewed ═══
  if (action === "mark_viewed") {
    const { offerId } = body;
    await supabase.from("engagement_offers").update({ status: "viewed", viewed_at: new Date().toISOString() }).eq("id", offerId).eq("status", "sent");
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
