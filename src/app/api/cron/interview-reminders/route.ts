import { NextRequest, NextResponse } from "next/server";
import { interviewAdminClient, loadBookingEmailData } from "@/lib/interviewBookingData";
import { sendReminderEmails } from "@/lib/interviewEmails";

/**
 * GET /api/cron/interview-reminders — every 15 minutes.
 *
 * Two windows per booking, each sent once:
 *   24h — starts within 24h, but not sooner than 22h (so a booking made
 *          inside the window isn't reminded minutes after its confirmation)
 *   1h  — starts within 1h, but not sooner than 15min (too late to be useful)
 *
 * Idempotent three ways: the sent-at flag is stamped before we could resend,
 * the query excludes stamped rows, and every email carries an idempotency
 * key — so an overlap or a crash mid-batch can't double-send.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = interviewAdminClient();
  const now = Date.now();
  const iso = (msFromNow: number) => new Date(now + msFromNow).toISOString();
  let sent24 = 0;
  let sent1 = 0;

  const { data: due24 } = await admin
    .from("interview_bookings")
    .select("id")
    .eq("status", "booked")
    .is("reminder_24h_sent_at", null)
    .gte("starts_at", iso(22 * 3600_000))
    .lte("starts_at", iso(24 * 3600_000))
    .limit(200);

  for (const row of due24 || []) {
    const { data: claimed } = await admin
      .from("interview_bookings")
      .update({ reminder_24h_sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("reminder_24h_sent_at", null)
      .select("id");
    if (!claimed?.length) continue; // another run claimed it
    const b = await loadBookingEmailData(row.id);
    if (b) {
      await sendReminderEmails(b, "24h");
      sent24++;
    }
  }

  const { data: due1 } = await admin
    .from("interview_bookings")
    .select("id")
    .eq("status", "booked")
    .is("reminder_1h_sent_at", null)
    .gte("starts_at", iso(15 * 60_000))
    .lte("starts_at", iso(3600_000))
    .limit(200);

  for (const row of due1 || []) {
    const { data: claimed } = await admin
      .from("interview_bookings")
      .update({ reminder_1h_sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("reminder_1h_sent_at", null)
      .select("id");
    if (!claimed?.length) continue;
    const b = await loadBookingEmailData(row.id);
    if (b) {
      await sendReminderEmails(b, "1h");
      sent1++;
    }
  }

  return NextResponse.json({ sent24, sent1 });
}
