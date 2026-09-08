import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { interviewAdminClient, loadBookingEmailData } from "@/lib/interviewBookingData";
import { sendCancellationEmails } from "@/lib/interviewEmails";
import { deleteInterviewRoom } from "@/lib/daily";
import { notifyClient } from "@/lib/notifyClient";
import { maskContact } from "@/lib/contactMask";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

/**
 * POST /api/interviews/cancel — { bookingId, reason? }
 *
 * cancel_interview (as the caller) decides whether this user may cancel and
 * which side they're on; the returned status tells us whose cancellation
 * email to write. Email data is loaded before the RPC so the notice still
 * has names even though the row survives cancellation anyway.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const limited = await enforceRateLimit(`iv-book:${user.id}`, LIMITS.interviewBook);
  if (limited) return limited;

  let body: { bookingId?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const bookingId = typeof body.bookingId === "string" ? body.bookingId : "";
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : null;
  if (!bookingId) return NextResponse.json({ error: "Missing bookingId" }, { status: 400 });

  // An interview whose scheduled end has passed already happened (or was a
  // no-show — a later step's problem); "cancelling" it now would rewrite the
  // record and email the other party a false cancellation notice.
  const admin = interviewAdminClient();
  const { data: timing } = await admin
    .from("interview_bookings")
    .select("starts_at, duration_minutes, room_name")
    .eq("id", bookingId)
    .single();
  if (
    timing &&
    Date.now() > new Date(timing.starts_at).getTime() + (timing.duration_minutes || 30) * 60_000
  ) {
    return NextResponse.json(
      { error: "This interview time has already passed — there's nothing to cancel." },
      { status: 409 }
    );
  }

  const emailData = await loadBookingEmailData(bookingId);

  const { data: newStatus, error } = await supabase.rpc("cancel_interview", {
    p_booking_id: bookingId,
    p_reason: reason,
  });
  if (error) {
    return NextResponse.json(
      { error: error.message.replace(/^.*?: /, "") },
      { status: 409 }
    );
  }

  // If the video room was already provisioned, tear it down: this ejects
  // anyone sitting in it and dead-ends every minted token.
  if (timing?.room_name) {
    await deleteInterviewRoom(timing.room_name, bookingId);
  }

  const cancelledBy = newStatus === "cancelled_by_candidate" ? "candidate" : "client";
  if (emailData) {
    await sendCancellationEmails(emailData, cancelledBy);
    // The side that did NOT cancel needs it in the product too — a slot
    // disappearing from a calendar with only an email to explain it is how
    // a client ends up waiting in an empty room. (The candidate's half is
    // written by the emails' own bell path.)
    if (cancelledBy === "candidate") {
      const when = emailData.startsAt.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
      await notifyClient(admin, {
        clientId: emailData.clientId,
        category: "interview",
        // The candidate's own display_name is theirs to edit, so it stays out
        // of the title — the trusted line in the platform's chrome — and
        // rides masked in the body instead. The messages route hardened
        // against exactly this ("From StaffVA Support — WhatsApp +63…") and
        // review caught the new sites reintroducing it.
        title: "An interview was cancelled",
        body: `${maskContact(emailData.candidate.name)} cancelled the ${when} interview. If they publish new times, you can book again from their profile.`,
        route: "/team#interviews",
        dedupeKey: `iv-cancelled-client-${bookingId}`,
      });
    }
  } else {
    console.error(`[interviews/cancel] cancelled ${bookingId} but could not load email data`);
  }

  return NextResponse.json({ status: newStatus });
}
