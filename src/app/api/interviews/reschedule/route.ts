import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { interviewAdminClient, loadBookingEmailData } from "@/lib/interviewBookingData";
import { sendBookingEmails, sendCancellationEmails } from "@/lib/interviewEmails";
import { deleteInterviewRoom } from "@/lib/daily";
import { notifyClient } from "@/lib/notifyClient";
import { maskContact } from "@/lib/contactMask";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

/**
 * POST /api/interviews/reschedule — { bookingId, startsAt, reason? }
 *
 * The reschedule_interview RPC (running as the caller) is the whole security
 * boundary and the whole correctness story: it cancels the old row and books
 * the new one in ONE transaction, so a failure on the new slot leaves the
 * original interview standing rather than destroying it. This route exists
 * for the things a database cannot do — tear down the video room and send
 * mail.
 *
 * Ordering matters after the RPC returns: the room belongs to the OLD
 * booking, so it is deleted only once the move has actually committed. Doing
 * it first would eject people from a call that a failed reschedule then left
 * scheduled.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Shares the booking bucket deliberately: a reschedule loop mails a
  // candidate exactly as a cancel→rebook loop does.
  const limited = await enforceRateLimit(`iv-book:${user.id}`, LIMITS.interviewBook);
  if (limited) return limited;

  let body: { bookingId?: unknown; startsAt?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const bookingId = typeof body.bookingId === "string" ? body.bookingId : "";
  const startsAt = typeof body.startsAt === "string" ? body.startsAt : "";
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : null;
  if (!bookingId || Number.isNaN(Date.parse(startsAt))) {
    return NextResponse.json({ error: "Missing bookingId or startsAt" }, { status: 400 });
  }

  const admin = interviewAdminClient();
  // Read the old row BEFORE the move: after it commits, room_name still lives
  // on the cancelled row, but reading first keeps this route honest if the
  // RPC ever stops preserving it. The email payload has to be loaded here too
  // — it is what addresses the CANCEL that retires the old calendar event.
  const { data: oldRow } = await admin
    .from("interview_bookings")
    .select("room_name, starts_at")
    .eq("id", bookingId)
    .maybeSingle();
  const oldEmailData = await loadBookingEmailData(bookingId);

  const { data: newId, error } = await supabase.rpc("reschedule_interview", {
    p_booking_id: bookingId,
    p_new_starts_at: startsAt,
    p_reason: reason,
  });
  if (error || !newId) {
    // Every failure path inside the function raises, which rolls the
    // cancellation back — so this really does mean "nothing changed".
    return NextResponse.json(
      { error: (error?.message || "Could not move that interview.").replace(/^.*?: /, "") },
      { status: 409 }
    );
  }

  // The old room is dead now: its booking is cancelled and every token minted
  // against it should stop working.
  if (oldRow?.room_name) {
    await deleteInterviewRoom(oldRow.room_name, bookingId);
  }

  // TWO calendar messages, in this order, and both are required.
  //
  // A METHOD:CANCEL for the OLD uid retires the event already sitting in both
  // calendars; without it a reschedule leaves the original 10:00 entry in
  // place beside the new 15:00 one, and the client turns up at 10:00. The
  // first draft sent only the new invite and did exactly that.
  if (oldEmailData) {
    await sendCancellationEmails(oldEmailData, "client");
  }

  // Then the invite for the new booking. sendBookingEmails is the same
  // function the original booking used, so both sides get it in the shape
  // they already know. A dedicated "moved" template would read better than a
  // cancel followed by an invite, and is worth doing when these emails are
  // next touched — but it must not come at the cost of the CANCEL, which is
  // the part calendars act on.
  const emailData = await loadBookingEmailData(newId as string);
  if (emailData) {
    await sendBookingEmails(emailData);
    // The client's own record of what they just did, read back by their
    // interviews page. (The candidate's bell is written by the email path.)
    //
    // In the CLIENT's timezone and WITH the time. toLocaleDateString with no
    // zone formats in the server's — UTC on Vercel — so a client at UTC-8
    // with an 02:00 UTC booking was told the wrong day, and told no time at
    // all. Falls back to UTC only when we have no zone for them, and says so.
    const tz = emailData.client.tz || "UTC";
    const when = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(emailData.startsAt);
    await notifyClient(admin, {
      clientId: emailData.clientId,
      category: "interview",
      // The candidate's display_name is theirs to edit, so it stays out of the
      // title — the trusted line in the platform's chrome — and rides masked
      // in the body, the same rule the cancel path follows.
      title: "Interview moved",
      body: `Your interview with ${maskContact(emailData.candidate.name)} is now ${when}.`,
      route: "/interviews",
      dedupeKey: `iv-rescheduled-${newId}`,
    });
  } else {
    console.error(`[interviews/reschedule] moved ${bookingId} → ${newId} but could not load email data`);
  }

  return NextResponse.json({ id: newId });
}
