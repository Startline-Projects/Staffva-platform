import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { executeOfferAccept, type OfferForAccept } from "@/lib/acceptOffer";
import { notifyCandidate } from "@/lib/notifyCandidate";
import { sendEmail } from "@/lib/email";
import { containsContact } from "@/lib/contactMask";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const CONTRACT_LENGTHS = new Set(["1 month", "3 months", "6 months", "12 months", "Ongoing"]);
const MAX_ROUNDS = 8;
const LENGTH_MONTHS: Record<string, number> = {
  "1 month": 1, "3 months": 3, "6 months": 6, "12 months": 12, "Ongoing": 12,
};

/**
 * Negotiation on an offer (Atlas 4.19) — owner decision 2026-09-05.
 *
 * The offer row is the envelope holding the CURRENT terms; offer_counters is
 * the round history. A counter rewrites the envelope (so the unchanged accept
 * path builds the engagement and contract from the latest terms), appends a
 * history row, recomputes the derived costs, resets the 5-day expiry clock,
 * and hands the turn to the other side. Original offer = the client's round
 * zero.
 *
 * Actions:
 *  - counter: whichever party the ball is with proposes new terms.
 *  - respond (client only): accept/decline the candidate's counter. The
 *    candidate's accept/decline stays on /api/offers action=respond.
 */
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const role = user.app_metadata?.role;
  if (role !== "client" && role !== "candidate") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = await enforceRateLimit(`offer-negotiate:${user.id}`, LIMITS.offerMessage);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const { action, offerId } = body as { action?: string; offerId?: string };
  if (!offerId || !/^[0-9a-f-]{36}$/i.test(offerId)) {
    return NextResponse.json({ error: "offerId required" }, { status: 400 });
  }

  const db = admin();
  const { data: offer } = await db
    .from("engagement_offers")
    .select("*")
    .eq("id", offerId)
    .maybeSingle();
  if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });

  // Party check against the caller's OWN row.
  if (role === "client") {
    const { data: client } = await db.from("clients").select("id").eq("user_id", user.id).maybeSingle();
    if (!client || client.id !== offer.client_id) {
      return NextResponse.json({ error: "Not your offer" }, { status: 403 });
    }
  } else {
    const { data: candidate } = await db.from("candidates").select("id").eq("user_id", user.id).maybeSingle();
    if (!candidate || candidate.id !== offer.candidate_id) {
      return NextResponse.json({ error: "Not your offer" }, { status: 403 });
    }
  }

  if (!["sent", "viewed", "countered"].includes(offer.status)) {
    return NextResponse.json({ error: "This offer is no longer open." }, { status: 409 });
  }

  // Whose turn? The party the last proposal was SENT TO — read from the
  // ENVELOPE, not the history table. Rounds strictly alternate (the original
  // offer is the client's round zero), so current_round's parity names the
  // last proposer: odd = candidate, even = client. History is display-only;
  // deriving the turn from it would let one failed history insert desync the
  // two and deadlock every later move against the current_round fence.
  const envRound: number = offer.current_round ?? 0;
  const lastProposedBy = envRound % 2 === 1 ? "candidate" : "client";
  const turn = lastProposedBy === "client" ? "candidate" : "client";

  if (action === "counter") {
    if (role !== turn) {
      return NextResponse.json(
        { error: role === "client"
            ? "You've made the last proposal — it's the candidate's turn."
            : "You've made the last proposal — it's the client's turn." },
        { status: 409 }
      );
    }
    const round = envRound + 1;
    if (round > MAX_ROUNDS) {
      return NextResponse.json(
        { error: "This negotiation has gone back and forth eight times — settle the rest in messages, then send a fresh offer." },
        { status: 409 }
      );
    }

    const { hourlyRate, hoursPerWeek, contractLength, startDate, message } = body as {
      hourlyRate?: number; hoursPerWeek?: number; contractLength?: string;
      startDate?: string; message?: string;
    };
    if (typeof hourlyRate !== "number" || hourlyRate < 1 || hourlyRate > 500) {
      return NextResponse.json({ error: "Rate must be between $1 and $500 per hour." }, { status: 400 });
    }
    if (!Number.isInteger(hoursPerWeek) || hoursPerWeek! < 1 || hoursPerWeek! > 60) {
      return NextResponse.json({ error: "Hours must be a whole number between 1 and 60." }, { status: 400 });
    }
    if (!contractLength || !CONTRACT_LENGTHS.has(contractLength)) {
      return NextResponse.json({ error: "Pick a contract length from the list." }, { status: 400 });
    }
    const start = startDate ? new Date(startDate) : null;
    if (!start || isNaN(start.getTime())) {
      return NextResponse.json({ error: "Pick a start date." }, { status: 400 });
    }
    if (message != null) {
      if (typeof message !== "string" || message.length > 500) {
        return NextResponse.json({ error: "Keep the note under 500 characters." }, { status: 400 });
      }
      // The same disintermediation rule as messages: no contact details
      // before a contract exists — a counter's note must not be the leak.
      if (message.trim() && containsContact(message)) {
        return NextResponse.json(
          { error: "Contact information can't be shared before a contract is in place. This keeps both parties protected." },
          { status: 400 }
        );
      }
    }

    const startIso = start.toISOString().split("T")[0];
    const monthlyEquiv = hourlyRate * hoursPerWeek! * 4.33;
    const clientMonthly = monthlyEquiv * 1.1;
    const months = LENGTH_MONTHS[contractLength] || 12;

    // ENVELOPE FIRST, fenced on current_round. The envelope is the
    // authoritative state (terms, status, turn-version); the history row is
    // the display record. The old order inserted history first, so an
    // envelope failure left a phantom round that permanently flipped the
    // turn. The .eq(current_round, round-1) fence is also what stops every
    // accept-vs-counter interleaving: any concurrent move changes the number
    // and this update matches zero rows.
    const { data: updated } = await db
      .from("engagement_offers")
      .update({
        hourly_rate: hourlyRate,
        hours_per_week: hoursPerWeek,
        contract_length: contractLength,
        start_date: startIso,
        estimated_monthly_cost: Math.round(clientMonthly * 100) / 100,
        estimated_contract_total: Math.round(clientMonthly * months * 100) / 100,
        status: "countered",
        current_round: round,
        sent_at: new Date().toISOString(),
        responded_at: null,
      })
      .eq("id", offerId)
      .eq("current_round", round - 1)
      .in("status", ["sent", "viewed", "countered"])
      .select("id")
      .maybeSingle();
    if (!updated) {
      return NextResponse.json(
        { error: "This offer just changed — reload to see where it stands." },
        { status: 409 }
      );
    }

    const { error: counterErr } = await db.from("offer_counters").insert({
      offer_id: offerId,
      round,
      proposed_by: role,
      hourly_rate: hourlyRate,
      hours_per_week: hoursPerWeek,
      contract_length: contractLength,
      start_date: startIso,
      message: message?.trim() || null,
    });
    if (counterErr && counterErr.code !== "23505") {
      // The envelope moved and is correct; the display history is missing a
      // round. Loud, not fatal — terms are never read from history.
      console.error("[negotiate] history insert failed:", counterErr.message);
    }

    // Tell the other side.
    if (role === "client") {
      await notifyCandidate(db, {
        candidateId: offer.candidate_id,
        category: "offer",
        title: "The client countered your proposal",
        body: `$${hourlyRate}/hr · ${hoursPerWeek} hrs/week · respond within 5 days.`,
        route: `/offers/${offerId}`,
        dedupeKey: `counter-${offerId}-${round}`,
      });
    } else {
      const { data: client } = await db.from("clients").select("email").eq("id", offer.client_id).maybeSingle();
      if (client?.email) {
        try {
          await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: client.email,
            subject: "The candidate countered your offer",
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Counter-offer received</h2>
              <p style="color:#444;font-size:14px;">The candidate proposed <strong>$${hourlyRate}/hr · ${hoursPerWeek} hrs/week · ${contractLength}</strong>. Accept, decline, or counter from your dashboard within 5 days.</p>
              <a href="${process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com"}/team#offers" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Review the counter</a>
            </div>`,
          }, { recipientKind: "client", emailType: "offer_counter" });
        } catch { /* the team page shows the counter regardless */ }
      }
    }

    return NextResponse.json({ success: true, round });
  }

  if (action === "respond") {
    // Client-side accept/decline of the candidate's counter. (The candidate's
    // own respond lives on /api/offers and is turn-checked there.)
    if (role !== "client") {
      return NextResponse.json({ error: "Use the offer page to respond." }, { status: 400 });
    }
    if (turn !== "client") {
      return NextResponse.json({ error: "It's the candidate's turn to respond." }, { status: 409 });
    }
    const { response } = body as { response?: string };

    const expectedRound = envRound;

    if (response === "accept") {
      const { data: transitioned } = await db
        .from("engagement_offers")
        .update({ status: "accepted", responded_at: new Date().toISOString() })
        .eq("id", offerId)
        .eq("status", "countered")
        .eq("current_round", expectedRound)
        .select("id");
      if (!transitioned?.length) {
        return NextResponse.json({ error: "This offer is no longer open." }, { status: 409 });
      }
      // Same fresh-read rule as the candidate path: the CAS froze the
      // envelope; execute what it froze, not the row from the top.
      const { data: acceptedOffer } = await db
        .from("engagement_offers")
        .select("*")
        .eq("id", offerId)
        .single();
      await executeOfferAccept(db, (acceptedOffer ?? offer) as OfferForAccept, "client");
      return NextResponse.json({ success: true, status: "accepted" });
    }

    if (response === "decline") {
      const { data: transitioned } = await db
        .from("engagement_offers")
        .update({ status: "declined", responded_at: new Date().toISOString() })
        .eq("id", offerId)
        .eq("status", "countered")
        .eq("current_round", expectedRound)
        .select("id");
      if (!transitioned?.length) {
        return NextResponse.json({ error: "This offer is no longer open." }, { status: 409 });
      }
      await notifyCandidate(db, {
        candidateId: offer.candidate_id,
        category: "offer",
        title: "The client declined your counter-offer",
        body: "The negotiation on this offer is closed. They may send a fresh offer, and you stay visible to other clients.",
        route: "/candidate/work",
        dedupeKey: `counter-declined-${offerId}`,
      });
      return NextResponse.json({ success: true, status: "declined" });
    }

    return NextResponse.json({ error: "Invalid response" }, { status: 400 });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

/**
 * GET — the round history for an offer, party-scoped. Both sides see the
 * same history; that is what makes it a record.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const offerId = searchParams.get("offerId");
  if (!offerId || !/^[0-9a-f-]{36}$/i.test(offerId)) {
    return NextResponse.json({ error: "offerId required" }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = admin();
  const { data: offer } = await db
    .from("engagement_offers")
    .select("id, client_id, candidate_id, status, current_round")
    .eq("id", offerId)
    .maybeSingle();
  if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });

  const role = user.app_metadata?.role;
  if (role === "client") {
    const { data: client } = await db.from("clients").select("id").eq("user_id", user.id).maybeSingle();
    if (!client || client.id !== offer.client_id) {
      return NextResponse.json({ error: "Not your offer" }, { status: 403 });
    }
  } else if (role === "candidate") {
    const { data: candidate } = await db.from("candidates").select("id").eq("user_id", user.id).maybeSingle();
    if (!candidate || candidate.id !== offer.candidate_id) {
      return NextResponse.json({ error: "Not your offer" }, { status: 403 });
    }
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: counters, error } = await db
    .from("offer_counters")
    .select("round, proposed_by, hourly_rate, hours_per_week, contract_length, start_date, message, created_at")
    .eq("offer_id", offerId)
    .order("round", { ascending: true });
  if (error) {
    return NextResponse.json({ error: "Could not load the history." }, { status: 500 });
  }

  // Same envelope-parity rule as POST — the two must never disagree.
  return NextResponse.json({
    counters: counters ?? [],
    turn: (offer.current_round ?? 0) % 2 === 1 ? "client" : "candidate",
    status: offer.status,
  });
}
