import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { loadAwaitingThreads } from "@/lib/recruiterThread";

/**
 * Daily: who has written to StaffVA and had no answer.
 *
 * This exists because the in-product half of step 15 cannot work on its own.
 * Nine candidates are waiting, eight since April, one for 141 days — and a
 * candidate sending a message creates no email (candidate mail is frozen) and no
 * notification of any kind. recruiter_notifications holds 39 rows, every one
 * unread, none about a message, none newer than 23 April. So the only way a
 * recruiter learns of a message today is by choosing to open the chat, and the
 * record shows that has not happened since April.
 *
 * Adding a fortieth in-app notification would repeat the failure. This pushes
 * OUT instead — to Slack and to staff email, which the freeze permits
 * (emailFreeze allowlists staff) — and it goes to the assigned specialist AND
 * every manager and admin, because seven of the eight assigned specialists have
 * not signed in since April.
 *
 * It returns 503 while anything has been waiting more than SLA_DAYS, so the
 * Vercel cron dashboard stays red until somebody actually answers. That is the
 * intended behaviour, not a bug: an alert that goes green while nine people are
 * still waiting is how this went unnoticed for four months.
 */

export const dynamic = "force-dynamic";

const SLA_DAYS = 2;
/** Older than this and the run reports failure rather than merely reporting. */
const RED_DAYS = 7;

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function postToSlack(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Never throw from the alerter: the non-2xx return is the backstop and must
    // not depend on Slack being reachable.
    console.error("[unanswered-messages] Slack post failed:", err);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(req: NextRequest) {
  // Gated like every other cron. A 401 here shows red in Vercel too, which is
  // the point — an unauthenticated endpoint that posts to Slack is a worse trade
  // than being unable to report your own missing secret.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let threads;
  try {
    threads = await loadAwaitingThreads();
  } catch (err) {
    console.error("[unanswered-messages] scan failed:", err);
    return NextResponse.json({ error: "scan failed" }, { status: 503 });
  }

  const overdue = threads.filter((t) => (t.daysWaiting ?? 0) >= SLA_DAYS);
  const red = threads.filter((t) => (t.daysWaiting ?? 0) >= RED_DAYS);

  if (overdue.length === 0) {
    return NextResponse.json({ waiting: threads.length, overdue: 0, notified: 0 });
  }

  const lines = overdue.map(
    (t) =>
      `• ${t.candidateName ?? "Candidate"} — ${t.daysWaiting}d` +
      `${t.unansweredCount > 1 ? `, ${t.unansweredCount} messages` : ""}` +
      `${t.everReplied ? "" : ", never had a reply"}` +
      ` → ${t.assigneeName ?? "unassigned"}`
  );

  await postToSlack(
    `*${overdue.length} candidate${overdue.length === 1 ? "" : "s"} waiting on a reply*\n` +
      lines.join("\n") +
      `\n<${process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com"}/admin/messages|Open the queue>`
  );

  // Staff email: the assigned specialist AND everyone who could act. Sending
  // only to the assignee would reproduce the failure — most of them have not
  // signed in since April.
  const db = getAdminClient();
  const { data: staff } = await db
    .from("profiles")
    .select("email, role")
    .in("role", ["admin", "recruiting_manager"]);

  const recipients = new Set<string>();
  for (const s of staff ?? []) if (s.email) recipients.add(s.email);
  for (const t of overdue) if (t.assigneeEmail) recipients.add(t.assigneeEmail);

  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;">` +
    `<h2 style="color:#1C1B1A;font-size:18px;">${overdue.length} candidate${overdue.length === 1 ? "" : "s"} waiting on a reply</h2>` +
    `<ul style="color:#444;font-size:14px;line-height:1.7;padding-left:18px;">` +
    overdue
      .map(
        (t) =>
          `<li><strong>${escapeHtml(t.candidateName ?? "Candidate")}</strong> — ${t.daysWaiting} days` +
          `${t.unansweredCount > 1 ? `, ${t.unansweredCount} messages` : ""}` +
          `${t.everReplied ? "" : ", never had a reply"}` +
          ` (${escapeHtml(t.assigneeName ?? "unassigned")})</li>`
      )
      .join("") +
    `</ul>` +
    `<a href="${process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com"}/admin/messages" ` +
    `style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:8px;">Open the queue</a>` +
    `<p style="color:#999;font-size:12px;margin-top:24px;">Candidates are not emailed about any of this — candidate mail is frozen — so the only way they hear back is a reply in the portal.</p>` +
    `</div>`;

  let notified = 0;
  for (const to of recipients) {
    try {
      const res = await sendEmail(
        {
          from: "StaffVA <notifications@staffva.com>",
          to,
          subject: `${overdue.length} candidate${overdue.length === 1 ? "" : "s"} waiting on a reply`,
          html,
        },
        { recipientKind: "staff", emailType: "unanswered_messages_digest" }
      );
      if (!(res as { suppressed?: boolean })?.suppressed) notified++;
    } catch (err) {
      console.error("[unanswered-messages] send failed:", err);
    }
  }

  const payload = {
    waiting: threads.length,
    overdue: overdue.length,
    over7Days: red.length,
    notified,
    oldestDays: overdue[0]?.daysWaiting ?? null,
  };

  // Red while anyone has been waiting a week or more. Deliberate: this run
  // should not look successful while the April threads are still open.
  if (red.length > 0) {
    return NextResponse.json(
      { ...payload, error: `${red.length} thread(s) waiting over ${RED_DAYS} days` },
      { status: 503 }
    );
  }
  return NextResponse.json(payload);
}
