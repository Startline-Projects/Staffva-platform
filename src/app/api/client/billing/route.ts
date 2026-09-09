import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { maskContact } from "@/lib/contactMask";
import { clampPeriod, milestoneClientCharge, periodClientCharge, ROW_CAP, type MoneyEngagement } from "@/lib/escrowMoney";
import { hasTranscriptAccess, type AccessRow } from "@/lib/transcriptAccess";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET /api/client/billing — what this client has spent, is holding in escrow,
 * and owes next.
 *
 * Every figure is derived from payment_periods and milestones at read time.
 * There is no invoice entity on this platform and no stored client-side
 * total: the charged amount lives only in the Stripe PaymentIntent, so it is
 * recomputed through @/lib/escrowMoney — the same helper the approvals queue
 * uses, because two surfaces deriving the same money differently is worse
 * than either being wrong alone.
 *
 * Not built, because nothing backs it: Atlas's INV-2025-0124-ML invoice ids
 * (no such scheme), per-invoice PDFs, the "12% vs Dec" trend (needs a
 * comparable prior month, and there is no spend at all yet), "Add accountant",
 * and its 8% fee — ours is 10%, charged on top.
 */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = admin();
  const { data: client, error: clientErr } = await db
    .from("clients").select("id").eq("user_id", user.id).maybeSingle();
  if (clientErr) return NextResponse.json({ error: "Could not load your billing." }, { status: 500 });
  if (!client) return NextResponse.json({ error: "Not a client account" }, { status: 403 });

  // The card on file. Read SEPARATELY and failing SOFT: migration
  // `client_verification` is not applied, so these columns do not exist yet —
  // and a missing column must not 500 the page that explains a client's
  // money. Unreadable means "we can't tell you", never "you have no card".
  let card: { brand: string | null; last4: string | null; exp: string | null } | null = null;
  let cardReadable = true;
  const { data: cardRow, error: cardErr } = await db
    .from("clients")
    .select("payment_method_brand, payment_method_last4, payment_method_exp_month, payment_method_exp_year, transcript_access_status, transcript_access_until, transcript_access_interval")
    .eq("id", client.id)
    .maybeSingle();
  if (cardErr) cardReadable = false;
  else if (cardRow?.payment_method_last4) {
    card = {
      brand: (cardRow.payment_method_brand as string) ?? null,
      last4: (cardRow.payment_method_last4 as string) ?? null,
      exp:
        cardRow.payment_method_exp_month && cardRow.payment_method_exp_year
          ? `${String(cardRow.payment_method_exp_month).padStart(2, "0")}/${String(cardRow.payment_method_exp_year).slice(-2)}`
          : null,
    };
  }

  // Read from the same row as the card, and through the SAME predicate the
  // paywall itself uses — so the billing page cannot tell a client they are
  // subscribed while the transcript route turns them away.
  const transcripts = cardRow
    ? {
        active: hasTranscriptAccess(cardRow as unknown as AccessRow),
        status: (cardRow.transcript_access_status as string) ?? "none",
        until: (cardRow.transcript_access_until as string) ?? null,
        interval: (cardRow.transcript_access_interval as string) ?? null,
      }
    : null;

  const { data: engRows, error: engErr } = await db
    .from("engagements")
    .select("id, status, payment_cycle, weekly_hours, client_total_usd, ends_at, paused_at, candidates(id, display_name)")
    .eq("client_id", client.id);
  if (engErr) {
    console.error("[client/billing] engagements failed:", engErr.message);
    return NextResponse.json({ error: "Could not load your billing." }, { status: 500 });
  }

  type Eng = MoneyEngagement & {
    id: string;
    status: string;
    paused_at: string | null;
    candidates: { id?: string; display_name?: string } | null;
  };
  const engs = (engRows ?? []) as unknown as Eng[];
  const engById = new Map(engs.map((e) => [e.id, e]));
  const engIds = engs.map((e) => e.id);

  if (engIds.length === 0) {
    return NextResponse.json({
      spend: { thisMonth: 0, lifetime: 0, sinceIso: null },
      escrowHeld: 0,
      upcoming: [],
      activity: [],
      statements: [],
      card,
      cardReadable,
      transcripts,
      signalsOk: true,
    });
  }

  const [periodsRes, milestonesRes] = await Promise.all([
    // ORDERED, or "which 1000 rows" is undefined and a total silently
    // changes between loads.
    db.from("payment_periods")
      .select("id, engagement_id, period_start, period_end, amount_usd, status, funded_at, released_at")
      .in("engagement_id", engIds).order("period_start", { ascending: false }).limit(ROW_CAP),
    db.from("milestones")
      .select("id, engagement_id, title, amount_usd, status, funded_at, released_at, marked_complete_at")
      .in("engagement_id", engIds).order("created_at", { ascending: false }).limit(ROW_CAP),
  ]);

  let signalsOk = true;
  for (const [name, res] of [["periods", periodsRes], ["milestones", milestonesRes]] as const) {
    if (res.error) {
      console.error(`[client/billing] ${name} failed:`, res.error.message);
      signalsOk = false;
    }
  }

  const now = new Date();
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

  let thisMonth = 0;
  let lifetime = 0;
  let escrowHeld = 0;
  let earliestSpend: number | null = null;
  const upcoming: unknown[] = [];
  const activity: { at: string; kind: string; label: string; who: string | null; amount: number }[] = [];
  const byMonth = new Map<string, { count: number; total: number }>();

  const record = (
    e: Eng,
    id: string,
    label: string,
    status: string,
    fundedAt: string | null,
    releasedAt: string | null,
    charge: number
  ) => {
    const who = e.candidates ? maskContact(String(e.candidates.display_name ?? "")) || "Candidate" : null;

    // REFUNDED first: the money came back, so it is neither spent nor held.
    // Without this it fell through to the funded_at branch and was reported
    // as sitting in escrow — money the client has already got back, shown as
    // still committed. Both enums carry this value (period_status_type and
    // milestone_status_type).
    if (status === "refunded") {
      if (fundedAt) {
        activity.push({ at: fundedAt, kind: "refunded_undated", label, who, amount: charge });
      }
      // NOTHING writes a refund timestamp — disputes/resolve and the Stripe
      // webhook both set `status` alone — so a refund cannot be dated. It is
      // marked on the funding event instead of being given an invented date
      // or dropped, which would leave the money vanishing from "held" with no
      // trace at all.
      if (releasedAt) {
        activity.push({ at: releasedAt, kind: "refunded", label, who, amount: charge });
      }
      return;
    }

    if (releasedAt) {
      const ms = new Date(releasedAt).getTime();
      lifetime += charge;
      if (ms >= monthStart) thisMonth += charge;
      if (earliestSpend === null || ms < earliestSpend) earliestSpend = ms;
      const key = releasedAt.slice(0, 7); // YYYY-MM
      const bucket = byMonth.get(key) ?? { count: 0, total: 0 };
      bucket.count += 1;
      bucket.total += charge;
      byMonth.set(key, bucket);
      activity.push({ at: releasedAt, kind: "released", label, who, amount: charge });
    } else if (fundedAt) {
      // Funded and not released: still in escrow. This covers `funded`,
      // `candidate_marked_complete`, `approved` and `disputed` — all of them
      // money the client has paid in and that has not gone anywhere yet.
      escrowHeld += charge;
    }

    if (fundedAt) {
      activity.push({ at: fundedAt, kind: "authorized", label, who, amount: charge });
    }
    void id;
  };

  for (const p of periodsRes.data ?? []) {
    const e = engById.get(p.engagement_id as string);
    if (!e) continue;
    const clamp = clampPeriod(
      p.period_start as string | null,
      p.period_end as string | null,
      Number(p.amount_usd),
      e
    );
    const charge = periodClientCharge(clamp.candidateAmount, e);
    const label = `Pay period ${p.period_start} to ${clamp.effectiveEnd}`;
    record(e, p.id as string, label, p.status as string, p.funded_at as string | null, p.released_at as string | null, charge);

    // Not yet funded and still fundable — what the client owes next.
    if (p.status === "pending" && !clamp.startsAfterEnd && e.status === "active") {
      upcoming.push({
        id: p.id,
        kind: "period",
        label,
        due: clamp.effectiveEnd,
        amount: charge,
        who: e.candidates ? maskContact(String(e.candidates.display_name ?? "")) || "Candidate" : null,
      });
    }
  }

  for (const m of milestonesRes.data ?? []) {
    const e = engById.get(m.engagement_id as string);
    if (!e) continue;
    const charge = milestoneClientCharge(Number(m.amount_usd));
    const label = (m.title as string) || "Milestone";
    record(e, m.id as string, label, m.status as string, m.funded_at as string | null, m.released_at as string | null, charge);

    if (m.status === "pending" && e.status === "active") {
      upcoming.push({
        id: m.id,
        kind: "milestone",
        label,
        due: null,
        amount: charge,
        who: e.candidates ? maskContact(String(e.candidates.display_name ?? "")) || "Candidate" : null,
      });
    }
  }

  activity.sort((a, b) => (a.at < b.at ? 1 : -1));

  const statements = Array.from(byMonth.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    // Rounded ONCE at the end, like `lifetime` — rounding on every addition
    // made the months sum to a different figure than the lifetime total
    // shown beside them.
    .map(([month, v]) => ({ month, payments: v.count, total: Math.round(v.total * 100) / 100 }));

  return NextResponse.json({
    transcripts,
    spend: {
      thisMonth: Math.round(thisMonth * 100) / 100,
      lifetime: Math.round(lifetime * 100) / 100,
      // Named so "lifetime" is never a claim about a period we can't see.
      sinceIso: earliestSpend ? new Date(earliestSpend).toISOString() : null,
    },
    escrowHeld: Math.round(escrowHeld * 100) / 100,
    truncated:
      (periodsRes.data ?? []).length >= ROW_CAP || (milestonesRes.data ?? []).length >= ROW_CAP,
    upcoming,
    activity: activity.slice(0, 50),
    statements,
    card,
    cardReadable,
    signalsOk,
  });
}
