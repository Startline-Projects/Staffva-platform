import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { maskContact } from "@/lib/contactMask";
import { computeVisibility } from "@/lib/candidateVisibility";
import {
  bucketFor,
  diffTerms,
  expiresAt,
  offerMoney,
  whoseTurn,
  type OfferTerms,
} from "@/lib/offerTerms";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * The client's proposals (client step 10) — what Atlas calls proposals is our
 * engagement_offers.
 *
 * Two shape differences from the prototype, both from owner decisions:
 *
 *  - D3 rules out candidate-initiated proposals, so Atlas's entire "Received"
 *    tab has no counterpart. Every offer here was sent BY this client; what
 *    varies is whose move it is. The tabs are therefore whose-turn, not
 *    who-sent.
 *  - D1 gates escrow FUNDING only. Atlas locks "send a proposal" behind
 *    identity verification and devotes its whole Sent tab to a verify wall.
 *    Sending stays open here, so none of that is reproduced.
 *
 * Money is derived, not read back: rate × hours × 4.33 × 1.1. The stored
 * estimated_monthly_cost is maintained by the negotiate path and should agree,
 * but a figure computed from the terms shown on the same card cannot drift
 * from them.
 */
/** Beyond this the page says so rather than quietly understating the totals. */
const OFFER_PAGE_LIMIT = 200;

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = admin();
  const { data: client, error: clientErr } = await db
    .from("clients").select("id").eq("user_id", user.id).maybeSingle();
  if (clientErr) {
    return NextResponse.json({ error: "Could not load your proposals." }, { status: 500 });
  }
  if (!client) return NextResponse.json({ error: "Not a client account" }, { status: 403 });

  // Typed by hand: the concatenated select string defeats supabase-js's row
  // inference, exactly as in /api/jobs/shortlist. Every field named here is
  // named in the select below.
  type OfferRow = {
    id: string;
    candidate_id: string;
    status: string;
    current_round: number | null;
    hourly_rate: number | string;
    hours_per_week: number | string;
    contract_length: string;
    start_date: string;
    signing_bonus_usd: number | string | null;
    personal_message: string | null;
    created_at: string;
    sent_at: string | null;
    viewed_at: string | null;
    responded_at: string | null;
    candidates: Record<string, unknown> | null;
  };

  const { data: offersRaw, error } = await db
    .from("engagement_offers")
    .select(
      "id, candidate_id, status, current_round, hourly_rate, hours_per_week, contract_length, " +
      "start_date, signing_bonus_usd, personal_message, created_at, sent_at, viewed_at, responded_at, " +
      "candidates(id, display_name, country, role_category, profile_photo_url, " +
      // Visibility columns: an open offer to a since-banned candidate must not
      // keep offering Message and View profile, the way /jobs/shortlist learned.
      "admin_status, permanently_blocked, id_verification_status, id_verification_due_at, " +
      "lock_status, availability_status, availability_last_updated_at, created_at)"
    )
    .eq("client_id", client.id)
    // Drafts have a null sent_at and Postgres sorts NULLs first on DESC, so
    // ordering on sent_at alone buries everything else behind them.
    .order("created_at", { ascending: false })
    .limit(OFFER_PAGE_LIMIT);

  if (error) {
    console.error("[client/proposals] read failed:", error.message);
    return NextResponse.json({ error: "Could not load your proposals." }, { status: 500 });
  }

  const offers = (offersRaw ?? []) as unknown as OfferRow[];
  const offerIds = offers.map((o) => o.id);
  // One read for every round of every offer, rather than one query per card.
  type CounterRow = OfferTerms & { round: number; proposed_by: string; message: string | null; created_at: string };
  const roundsByOffer = new Map<string, CounterRow[]>();
  let historyOk = true;
  if (offerIds.length > 0) {
    const { data: counters, error: cErr } = await db
      .from("offer_counters")
      .select("offer_id, round, proposed_by, hourly_rate, hours_per_week, contract_length, start_date, message, created_at")
      .in("offer_id", offerIds)
      .order("round", { ascending: true })
      .limit(2000);
    if (cErr) {
      // Loud: losing the history silently would render every negotiation as a
      // single opening offer, which is a different story than the truth.
      console.error("[client/proposals] history read failed:", cErr.message);
      historyOk = false;
    }
    for (const c of counters || []) {
      const list = roundsByOffer.get(c.offer_id as string) || [];
      list.push(c as unknown as CounterRow);
      roundsByOffer.set(c.offer_id as string, list);
    }
  }

  const proposals = offers.map((o) => {
    const rounds = roundsByOffer.get(o.id) || [];
    const current: OfferTerms = {
      hourly_rate: Number(o.hourly_rate),
      hours_per_week: Number(o.hours_per_week),
      contract_length: o.contract_length as string,
      start_date: o.start_date as string,
    };
    // The previous round is the last-but-one COUNTER, and only if it is
    // genuinely ADJACENT. negotiate writes the envelope first and tolerates a
    // failed offer_counters insert, so a gap is possible — without this fence
    // the card would strike through a value from two rounds back and present
    // it as the terms just replaced. There is deliberately no fallback to the
    // envelope either: countering overwrites it, so on a first counter the
    // terms being replaced are genuinely unrecoverable.
    const last = rounds.length >= 1 ? rounds[rounds.length - 1] : null;
    const candidatePrev = rounds.length >= 2 ? rounds[rounds.length - 2] : null;
    const previous =
      candidatePrev && last && candidatePrev.round === last.round - 1 ? candidatePrev : null;
    const cand = o.candidates;
    // Same treatment the shortlist gives a withdrawn candidate: say what
    // happened and stop offering actions that would reach them.
    let candWithdrawn: string | null = null;
    if (cand) {
      const vis = computeVisibility(cand);
      candWithdrawn = cand.permanently_blocked
        ? "This account has been closed."
        : cand.admin_status !== "approved"
          ? "No longer listed on StaffVA."
          : !vis.searchable
            ? "Temporarily hidden from search."
            : null;
    }

    return {
      id: o.id,
      status: o.status,
      currentRound: o.current_round ?? 0,
      turn: whoseTurn(o.current_round),
      bucket: bucketFor(o.status, o.current_round),
      terms: current,
      diff: diffTerms(current, previous),
      money: offerMoney(current.hourly_rate, current.hours_per_week),
      signingBonusUsd: o.signing_bonus_usd != null ? Number(o.signing_bonus_usd) : null,
      personalMessage: o.personal_message,
      createdAt: o.created_at,
      sentAt: o.sent_at,
      respondedAt: o.responded_at,
      expiresAt: expiresAt(o.sent_at, o.status)?.toISOString() ?? null,
      // True when offer_counters has a gap — the card then says the history is
      // incomplete rather than presenting it as the whole conversation.
      historyGap: rounds.some((r, i) => i > 0 && r.round !== rounds[i - 1].round + 1),
      // Each round, oldest first, for the history thread.
      history: rounds.map((r) => {
        const rr = r as unknown as Record<string, unknown>;
        return {
          round: rr.round as number,
          proposedBy: rr.proposed_by as "client" | "candidate",
          hourlyRate: Number(rr.hourly_rate),
          hoursPerWeek: Number(rr.hours_per_week),
          contractLength: rr.contract_length as string,
          startDate: rr.start_date as string,
          // Free text the candidate wrote, rendered to a client pre-hire —
          // maskContact is the primitive for arbitrary strings (maskCandidateText
          // only knows the named profile fields).
          message: rr.message ? maskContact(String(rr.message)) : null,
          createdAt: rr.created_at as string,
        };
      }),
      candidate: cand
        ? {
            id: cand.id as string,
            withdrawn: candWithdrawn,
            // maskContact, not maskCandidateText: the latter only knows the
            // named profile fields (bio, tagline, insights) and would return
            // display_name untouched while looking like protection.
            displayName: maskContact(String(cand.display_name ?? "")) || "Candidate",
            country: cand.country as string | null,
            roleCategory: cand.role_category as string | null,
            photo: cand.profile_photo_url as string | null,
          }
        : null,
    };
  });

  return NextResponse.json({
    proposals,
    historyOk,
    // The spend headline is a SUM, so a silent truncation would understate
    // money. The page says when it is showing a page rather than everything.
    truncated: offers.length >= OFFER_PAGE_LIMIT,
  });
}
