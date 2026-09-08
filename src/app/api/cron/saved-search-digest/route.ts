import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { countMatches, describeFilters, filtersToQuery, type SavedSearchFilters } from "@/lib/savedSearch";

/**
 * Saved-search digest (client step 8).
 *
 * Runs daily. Each search says how often it wants to hear — daily, weekly, or
 * never — and this only mails when the live count has risen above BOTH what
 * the client last saw and what we last told them about.
 *
 * Those two marks are deliberately separate columns:
 *
 *  - last_seen_count is the client's eyes. It moves only when they open the
 *    search on /shortlists, and it is what the "+3 more since you looked"
 *    badge is computed from. A send must not touch it, or an email nobody
 *    opened would clear the badge.
 *  - last_notified_count is our mouth. It moves on every send. Without it,
 *    "daily" means re-sending the byte-identical email every single day
 *    forever, because the client has no reason to visit the page that would
 *    move the other mark. That is precisely the Atlas behaviour this was
 *    supposed to improve on.
 *
 * So the rule is: mail about people who have arrived since the last thing
 * that happened, whichever of the two that was.
 *
 * Client mail is not under the candidate freeze (see emailFreeze), so these
 * genuinely send.
 */

export const dynamic = "force-dynamic";

const WEEKLY_DAYS = 7;

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminClient();
  const site = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";

  // Bounded. An unpaginated select is at the mercy of PostgREST's db-max-rows,
  // which would silently drop the tail of the table — a digest that quietly
  // stops covering some clients is worse than one that reports being full.
  const SCAN_LIMIT = 2000;
  const { data: rows, error } = await db
    .from("client_saved_searches")
    .select("id, client_id, name, filters, notify, last_seen_count, last_notified_count, last_notified_at")
    .neq("notify", "off")
    .order("last_notified_at", { ascending: true, nullsFirst: true })
    .limit(SCAN_LIMIT);

  if (error) {
    console.error("[saved-search-digest] scan failed:", error.message);
    return NextResponse.json({ error: "scan failed" }, { status: 503 });
  }

  const now = Date.now();
  // client id → the searches with something new, so one client with four
  // alerting searches gets one email rather than four.
  const perClient = new Map<string, { id: string; name: string; summary: string; href: string; added: number; total: number }[]>();
  let considered = 0;
  let countFailures = 0;

  for (const row of rows || []) {
    // Weekly means at most one message every seven days; daily is handled by
    // the schedule itself.
    if (row.notify === "weekly" && row.last_notified_at) {
      const since = (now - new Date(row.last_notified_at).getTime()) / 86_400_000;
      if (since < WEEKLY_DAYS) continue;
    }
    considered++;

    const filters = (row.filters || {}) as SavedSearchFilters;
    const total = await countMatches(db, filters);
    // A failed count is not zero. Skipping is right: mailing "0 matches" over
    // a broken query would read as the marketplace emptying out.
    if (total < 0) {
      countFailures++;
      continue;
    }
    // The later of the two marks. Mailing against last_seen_count alone
    // re-sends the same message daily; mailing against last_notified_count
    // alone would re-announce arrivals the client already read on the page.
    const mark = Math.max(row.last_seen_count ?? 0, row.last_notified_count ?? 0);
    const added = total - mark;
    if (added <= 0) continue;

    const q = filtersToQuery(filters);
    const entry = {
      id: row.id as string,
      name: row.name as string,
      summary: describeFilters(filters),
      href: `${site}/browse${q ? `?${q}` : ""}`,
      added,
      total,
    };
    const list = perClient.get(row.client_id as string) || [];
    list.push(entry);
    perClient.set(row.client_id as string, list);
  }

  if (perClient.size === 0) {
    return NextResponse.json({ considered, alerted: 0, sent: 0, countFailures });
  }

  const { data: clients } = await db
    .from("clients")
    .select("id, email, full_name")
    .in("id", Array.from(perClient.keys()));

  let sent = 0;
  let stampFailures = 0;

  for (const c of clients || []) {
    const entries = perClient.get(c.id) || [];
    if (!c.email || entries.length === 0) continue;

    const totalAdded = entries.reduce((n, e) => n + e.added, 0);
    const html =
      `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;">` +
      `<h2 style="color:#1C1B1A;font-size:18px;">${totalAdded} more ${totalAdded === 1 ? "person matches" : "people match"} your saved ${entries.length === 1 ? "search" : "searches"}</h2>` +
      entries
        .map(
          (e) =>
            `<div style="border:1px solid #E4DDCE;border-radius:10px;padding:14px;margin:12px 0;">` +
            `<div style="font-weight:600;color:#1C1B1A;font-size:15px;">${escapeHtml(e.name)}</div>` +
            `<div style="color:#6B6860;font-size:13px;margin-top:2px;">${escapeHtml(e.summary)}</div>` +
            `<div style="color:#444;font-size:13px;margin-top:8px;"><strong>${e.total}</strong> now match — <strong>${e.added}</strong> more than when we last counted</div>` +
            `<a href="${e.href}" style="display:inline-block;color:#FE6E3E;font-weight:600;font-size:13px;margin-top:8px;text-decoration:none;">See them →</a>` +
            `</div>`
        )
        .join("") +
      `<p style="color:#999;font-size:12px;margin-top:20px;">Change how often you hear about a search, or turn it off, on your ` +
      `<a href="${site}/shortlists" style="color:#999;">shortlists page</a>.</p>` +
      `</div>`;

    try {
      const res = await sendEmail(
        {
          from: "StaffVA <notifications@staffva.com>",
          to: c.email,
          subject:
            entries.length === 1
              ? `${entries[0].added} more ${entries[0].added === 1 ? "match" : "matches"} for “${entries[0].name}”`
              : `${totalAdded} more matches across ${entries.length} saved searches`,
          html,
        },
        { recipientKind: "client", emailType: "saved_search_digest" }
      );
      // A suppressed send is not a send. Stamping it would silence the search
      // for a week over an email that never left the building.
      if ((res as { suppressed?: boolean })?.suppressed) continue;
      sent++;
    } catch (err) {
      // One client's bad address must not stop the rest of the run, and must
      // not stamp as though it went out.
      console.error("[saved-search-digest] send failed:", err);
      continue;
    }

    // Stamped per client, immediately after that client's email, rather than
    // in one batch at the end: a timeout partway through the run would
    // otherwise lose every stamp and re-send the whole digest tomorrow. Only
    // the searches actually IN this email are stamped — the client's other
    // alerting searches were never mentioned.
    const stampedAt = new Date().toISOString();
    for (const e of entries) {
      const { error: stampErr } = await db
        .from("client_saved_searches")
        .update({ last_notified_at: stampedAt, last_notified_count: e.total })
        .eq("id", e.id);
      if (stampErr) {
        // Loud: an unstamped search mails again tomorrow, and the next day.
        console.error("[saved-search-digest] stamp failed:", e.id, stampErr.message);
        stampFailures++;
      }
    }
  }

  const payload = { considered, alerted: perClient.size, sent, countFailures, stampFailures };
  // Red while any stamp is missing — those searches will re-send tomorrow,
  // and a run that reports success while queuing duplicate mail is how this
  // goes unnoticed.
  if (stampFailures > 0) {
    return NextResponse.json(
      { ...payload, error: `${stampFailures} search(es) sent but not stamped — they will re-send` },
      { status: 503 }
    );
  }
  return NextResponse.json(payload);
}
