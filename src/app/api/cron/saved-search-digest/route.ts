import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { countMatches, describeFilters, filtersToQuery, type SavedSearchFilters } from "@/lib/savedSearch";

/**
 * Saved-search digest (client step 8).
 *
 * Runs daily. Each search says how often it wants to hear — daily, weekly, or
 * never — and this only mails when the live count has actually risen above
 * the number the client last saw. Two rules follow from that, and both matter
 * more than they look:
 *
 *  - It mails about a RISE, not about a total. A search that has matched the
 *    same eleven people since March generates nothing, forever. The Atlas
 *    prototype's alert has no such notion and would mail every day about the
 *    same eleven.
 *  - Sending advances last_notified_at but NOT last_seen_count. The high-water
 *    mark belongs to the client's eyes: if it moved on send, the "+3 more
 *    since you looked" badge would be cleared by an email they never opened,
 *    and the page would show nothing new.
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

  const { data: rows, error } = await db
    .from("client_saved_searches")
    .select("id, client_id, name, filters, notify, last_seen_count, last_notified_at")
    .neq("notify", "off");

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
    const added = total - (row.last_seen_count ?? 0);
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
  const notifiedSearchIds: string[] = [];

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
            `<div style="color:#444;font-size:13px;margin-top:8px;"><strong>+${e.added}</strong> since you last looked · ${e.total} in total</div>` +
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
      if (!(res as { suppressed?: boolean })?.suppressed) sent++;
    } catch (err) {
      // One client's bad address must not stop the rest of the run, and must
      // not stamp last_notified_at as though it went out.
      console.error("[saved-search-digest] send failed:", err);
      continue;
    }

    // Only the searches that were actually IN this email. Stamping the
    // client's other alerting searches would silence a weekly one for another
    // seven days without it ever having been mentioned.
    for (const e of entries) notifiedSearchIds.push(e.id);
  }

  // Only last_notified_at moves. last_seen_count stays where the client left
  // it, so the badge still says "+3 more since you looked" when they arrive.
  if (notifiedSearchIds.length > 0) {
    const { error: stampErr } = await db
      .from("client_saved_searches")
      .update({ last_notified_at: new Date().toISOString() })
      .in("id", notifiedSearchIds);
    if (stampErr) {
      // Loud, because a silent failure here means weekly searches mail every
      // single day.
      console.error("[saved-search-digest] stamp failed:", stampErr.message);
      return NextResponse.json(
        { considered, alerted: perClient.size, sent, countFailures, error: "could not stamp last_notified_at" },
        { status: 503 }
      );
    }
  }

  return NextResponse.json({ considered, alerted: perClient.size, sent, countFailures });
}
