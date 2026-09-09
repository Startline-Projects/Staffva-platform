import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { maskContact } from "@/lib/contactMask";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET /api/client/approvals — every money decision waiting on this client.
 *
 * Atlas calls this screen "Time & Approvals" and it is entirely timesheets:
 * days worked, editable hour cells, "Approve & release $184". The owner's D2
 * keeps funded periods and rules out timesheets, so there are no hours to
 * approve and none are invented. What a client actually decides here is:
 *   1. fund a period or milestone (money leaves), and
 *   2. release a milestone the candidate says is done (money arrives).
 *
 * ⚠️ THE TWO CLOCKS ARE DIFFERENT AND MUST NOT BE CONFLATED. That mistake has
 * already been made once on this platform, in step 3's copy:
 *   - a funded PERIOD auto-releases at period_end + 48h, and the dispute
 *     window closes at the same instant;
 *   - a milestone marked complete auto-releases at marked + 7 DAYS, but the
 *     dispute window closes at marked + 48 HOURS — five days earlier.
 * Both are returned separately, per item, from the columns that drive them.
 */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = admin();
  const { data: client, error: clientErr } = await db
    .from("clients").select("id").eq("user_id", user.id).maybeSingle();
  if (clientErr) return NextResponse.json({ error: "Could not load your approvals." }, { status: 500 });
  if (!client) return NextResponse.json({ error: "Not a client account" }, { status: 403 });

  // Every engagement this client has, so an item can name the person.
  const { data: engagements, error: engErr } = await db
    .from("engagements")
    .select("id, status, paused_at, contract_type, payment_cycle, client_total_usd, weekly_hours, ends_at, candidates(id, display_name)")
    .eq("client_id", client.id);
  if (engErr) {
    console.error("[client/approvals] engagements failed:", engErr.message);
    return NextResponse.json({ error: "Could not load your approvals." }, { status: 500 });
  }

  type Eng = {
    id: string;
    status: string;
    paused_at: string | null;
    contract_type: string | null;
    payment_cycle: string | null;
    client_total_usd: number | string | null;
    weekly_hours: number | null;
    ends_at: string | null;
    candidates: { id?: string; display_name?: string } | null;
  };
  const engs = (engagements ?? []) as unknown as Eng[];
  const engById = new Map(engs.map((e) => [e.id, e]));
  const engIds = engs.map((e) => e.id);

  if (engIds.length === 0) {
    return NextResponse.json({ items: [], signalsOk: true });
  }

  const [periodsRes, milestonesRes, disputesRes] = await Promise.all([
    db.from("payment_periods")
      .select("id, engagement_id, period_start, period_end, amount_usd, status, funded_at, released_at, auto_release_at, dispute_filed_at")
      .in("engagement_id", engIds)
      .order("period_start", { ascending: true })
      .limit(500),
    db.from("milestones")
      .select("id, engagement_id, title, amount_usd, status, funded_at, marked_complete_at, approved_at, released_at, auto_release_at")
      .in("engagement_id", engIds)
      .order("created_at", { ascending: true })
      .limit(500),
    // Any dispute already on file suppresses the Dispute action, so the page
    // never offers a second one on the same item.
    // No `status` column on disputes — it carries `decision` and
    // `resolved_at`. Selecting a column that does not exist 400s the whole
    // read, which would have set signalsOk false on every load and quietly
    // dropped the already-disputed check.
    db.from("disputes")
      .select("id, period_id, milestone_id, decision, resolved_at")
      .in("engagement_id", engIds)
      .limit(500),
  ]);

  // Each read fails independently and loudly — a queue that quietly loses the
  // milestones half would tell a client they have nothing to approve.
  let signalsOk = true;
  for (const [name, res] of [["periods", periodsRes], ["milestones", milestonesRes], ["disputes", disputesRes]] as const) {
    if (res.error) {
      console.error(`[client/approvals] ${name} failed:`, res.error.message);
      signalsOk = false;
    }
  }

  // An UNRESOLVED dispute is what suppresses the action; a resolved one is
  // history and must not permanently hide the button.
  const open = (disputesRes.data ?? []).filter((d) => !d.resolved_at);
  const disputedPeriod = new Set(open.map((d) => d.period_id).filter(Boolean));
  const disputedMilestone = new Set(open.map((d) => d.milestone_id).filter(Boolean));

  const H48 = 48 * 60 * 60 * 1000;
  const items: unknown[] = [];

  for (const p of periodsRes.data ?? []) {
    const e = engById.get(p.engagement_id as string);
    if (!e) continue;
    const status = p.status as string;
    if (status === "released" || status === "refunded") continue;

    // hourlyBasis must match the fund route EXACTLY — it is
    // `payment_cycle == null && weekly_hours != null` there, not just the
    // absence of a cycle. Where they disagreed, the button printed
    // amount_usd × 1.1 while Stripe charged client_total_usd, an unrelated
    // figure derived from a rate rather than from this period.
    const hourlyBasis = e.payment_cycle == null && e.weekly_hours != null;

    // Notice CLAMPS a period that straddles the end date: the fund route
    // rewrites period_end to ends_at and scales amount_usd by the fraction
    // before charging. Without mirroring that, the card printed the full
    // month's figure and its own date range, and both were wrong the instant
    // the button was clicked.
    let candidateAmount = Number(p.amount_usd);
    let effectiveEnd = p.period_end as string | null;
    let clamped = false;
    let unfundable = false;
    if (e.ends_at && p.period_start && p.period_end) {
      const endsMs = new Date(e.ends_at as string).getTime();
      const startMs = new Date(`${p.period_start}T00:00:00Z`).getTime();
      const endMs = new Date(`${p.period_end}T00:00:00Z`).getTime();
      if (startMs >= endsMs) {
        // fund() 409s outright here — the engagement is over before this
        // period begins.
        unfundable = true;
      } else if (endMs > endsMs) {
        const fraction = (endsMs - startMs) / (endMs - startMs);
        candidateAmount = Math.round(Number(p.amount_usd) * fraction * 100) / 100;
        effectiveEnd = new Date(endsMs).toISOString().split("T")[0];
        clamped = true;
      }
    }

    const clientCharge = hourlyBasis
      ? Math.round(candidateAmount * 1.1 * 100) / 100
      : Number(e.client_total_usd ?? 0);

    // The dispute window keys on the EFFECTIVE end, the same value fund
    // writes back to the row.
    const periodEndMs = effectiveEnd ? new Date(`${effectiveEnd}T00:00:00Z`).getTime() : null;
    items.push({
      kind: "period",
      id: p.id,
      engagementId: p.engagement_id,
      title: `${p.period_start} to ${effectiveEnd}`,
      status,
      candidateAmount,
      clientCharge,
      // Both surfaced so the card can explain a shortened period rather than
      // quietly printing a smaller number than the client expected.
      clamped,
      unfundable,
      fundedAt: p.funded_at,
      // Period: dispute closes exactly when it auto-releases, so ONE date.
      autoReleaseAt: p.auto_release_at,
      disputeClosesAt: periodEndMs ? new Date(periodEndMs + H48).toISOString() : null,
      disputeFiled: !!p.dispute_filed_at || disputedPeriod.has(p.id),
      paused: !!e.paused_at,
      candidate: e.candidates
        ? { id: e.candidates.id, name: maskContact(String(e.candidates.display_name ?? "")) || "Candidate" }
        : null,
    });
  }

  for (const m of milestonesRes.data ?? []) {
    const e = engById.get(m.engagement_id as string);
    if (!e) continue;
    const status = m.status as string;
    if (status === "released" || status === "refunded") continue;

    const markedMs = m.marked_complete_at ? new Date(m.marked_complete_at as string).getTime() : null;
    items.push({
      kind: "milestone",
      id: m.id,
      engagementId: m.engagement_id,
      title: (m.title as string) || "Milestone",
      status,
      candidateAmount: Number(m.amount_usd),
      // Milestones are funded up front at the fee-inclusive amount. The
      // arithmetic mirrors fund()'s EXACT expression — `a + a*0.1` rounded
      // once — not `a * 1.1`: the two differ by a cent on ~1.2% of values
      // (0.15 + 0.015 = 0.16499999999999998 vs 0.165), always with the
      // printed figure a cent above the charge.
      clientCharge: Math.round((Number(m.amount_usd) + Number(m.amount_usd) * 0.1) * 100) / 100,
      fundedAt: m.funded_at,
      markedCompleteAt: m.marked_complete_at,
      // SEVEN days.
      autoReleaseAt: m.auto_release_at,
      // FORTY-EIGHT hours — five days earlier, and the reason both dates are
      // returned rather than one being derived from the other.
      disputeClosesAt: markedMs ? new Date(markedMs + H48).toISOString() : null,
      disputeFiled: disputedMilestone.has(m.id),
      paused: !!e.paused_at,
      candidate: e.candidates
        ? { id: e.candidates.id, name: maskContact(String(e.candidates.display_name ?? "")) || "Candidate" }
        : null,
    });
  }

  const truncated =
    (periodsRes.data ?? []).length >= 500 ||
    (milestonesRes.data ?? []).length >= 500 ||
    (disputesRes.data ?? []).length >= 500;

  return NextResponse.json({ items, signalsOk, truncated });
}
