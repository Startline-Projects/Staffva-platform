import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { maskContact } from "@/lib/contactMask";
import { clampPeriod, milestoneClientCharge, periodClientCharge, ROW_CAP, type MoneyEngagement } from "@/lib/escrowMoney";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET /api/client/billing/export[?month=YYYY-MM] — the client's payments as
 * CSV.
 *
 * Atlas offers "Export all", per-invoice PDF downloads and per-statement
 * CSV/PDF buttons, none of which are wired. This is the one of those that can
 * be honest: a CSV is derived from the rows themselves, needs no invoice
 * entity and no document store, and is what "hand it to your accountant"
 * actually means. PDFs are not built — a PDF implies a rendered document of
 * record, and there isn't one.
 *
 * Only RELEASED items appear: those are the payments that happened. Money
 * sitting in escrow has not been spent, and putting it in an accounting
 * export would overstate the year.
 */
/** A number: quoted, never formula-guarded. */
function csvNum(v: number | string): string {
  return `"${String(v)}"`;
}

/**
 * Free text: quoted AND formula-guarded.
 *
 * The guard applies to TEXT ONLY. Applied to a numeric column it prefixes an
 * apostrophe to any negative value, which Excel then treats as text — so the
 * accountant's SUM() silently skips those rows, which is the exact opposite
 * of what an export is for.
 */
function csvText(v: string | null): string {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month");
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  const db = admin();
  const { data: client } = await db
    .from("clients").select("id").eq("user_id", user.id).maybeSingle();
  if (!client) return NextResponse.json({ error: "Not a client account" }, { status: 403 });

  // EVERY read is checked. An unchecked failure here returns a clean,
  // correctly-named CSV containing only a header row — a client hands their
  // accountant a file saying they paid nothing all year, and nothing anywhere
  // says otherwise. On a financial export that is the worst possible way to
  // fail, so this one refuses instead.
  const { data: engRows, error: engErr } = await db
    .from("engagements")
    .select("id, payment_cycle, weekly_hours, client_total_usd, ends_at, candidates(display_name)")
    .eq("client_id", client.id);
  if (engErr) {
    console.error("[billing/export] engagements failed:", engErr.message);
    return NextResponse.json(
      { error: "We couldn't build your export just now. Try again — an incomplete file would be worse than none." },
      { status: 503 }
    );
  }
  type Eng = MoneyEngagement & { id: string; candidates: { display_name?: string } | null };
  const engs = (engRows ?? []) as unknown as Eng[];
  const engById = new Map(engs.map((e) => [e.id, e]));
  const engIds = engs.map((e) => e.id);

  const rows: string[] = [
    ["Released", "Contractor", "Item", "Their amount (USD)", "StaffVA fee (USD)", "You paid (USD)"]
      .map(csvText)
      .join(","),
  ];

  if (engIds.length > 0) {
    const [periods, milestones] = await Promise.all([
      // `status` is selected and refunded rows are excluded: money that came
      // back is not money paid, and the page already excludes it — a CSV that
      // disagreed with the page about the same year would be worse than
      // either being wrong alone.
      db.from("payment_periods")
        .select("engagement_id, period_start, period_end, amount_usd, released_at, status")
        .in("engagement_id", engIds).not("released_at", "is", null)
        .neq("status", "refunded")
        .order("released_at", { ascending: false }).limit(ROW_CAP),
      db.from("milestones")
        .select("engagement_id, title, amount_usd, released_at, status")
        .in("engagement_id", engIds).not("released_at", "is", null)
        .neq("status", "refunded")
        .order("released_at", { ascending: false }).limit(ROW_CAP),
    ]);
    if (periods.error || milestones.error) {
      console.error(
        "[billing/export] rows failed:",
        periods.error?.message ?? "",
        milestones.error?.message ?? ""
      );
      return NextResponse.json(
        { error: "We couldn't build your export just now. Try again — an incomplete file would be worse than none." },
        { status: 503 }
      );
    }

    // Text cells and numeric cells are escaped differently, so a row keeps
    // them apart rather than mapping one function over everything.
    const lines: { at: string; text: string[]; nums: string[] }[] = [];

    for (const p of periods.data ?? []) {
      const e = engById.get(p.engagement_id as string);
      if (!e || !p.released_at) continue;
      if (month && !String(p.released_at).startsWith(month)) continue;
      const clamp = clampPeriod(
        p.period_start as string | null, p.period_end as string | null,
        Number(p.amount_usd), e
      );
      const paid = periodClientCharge(clamp.candidateAmount, e);
      lines.push({
        at: p.released_at as string,
        text: [
          String(p.released_at).slice(0, 10),
          maskContact(String(e.candidates?.display_name ?? "")) || "Candidate",
          `Pay period ${p.period_start} to ${clamp.effectiveEnd}`,
        ],
        nums: [
          clamp.candidateAmount.toFixed(2),
          (Math.round((paid - clamp.candidateAmount) * 100) / 100).toFixed(2),
          paid.toFixed(2),
        ],
      });
    }

    for (const m of milestones.data ?? []) {
      const e = engById.get(m.engagement_id as string);
      if (!e || !m.released_at) continue;
      if (month && !String(m.released_at).startsWith(month)) continue;
      const amount = Number(m.amount_usd);
      const paid = milestoneClientCharge(amount);
      lines.push({
        at: m.released_at as string,
        text: [
          String(m.released_at).slice(0, 10),
          maskContact(String(e.candidates?.display_name ?? "")) || "Candidate",
          (m.title as string) || "Milestone",
        ],
        nums: [
          amount.toFixed(2),
          (Math.round((paid - amount) * 100) / 100).toFixed(2),
          paid.toFixed(2),
        ],
      });
    }

    lines.sort((a, b) => (a.at < b.at ? 1 : -1));
    for (const l of lines) {
      rows.push([...l.text.map(csvText), ...l.nums.map(csvNum)].join(","));
    }
  }

  const filename = month ? `staffva-payments-${month}.csv` : "staffva-payments.csv";
  return new NextResponse(rows.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
