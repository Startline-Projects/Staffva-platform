import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { loadBookingEmailData } from "@/lib/interviewBookingData";
import { sendCancellationEmails } from "@/lib/interviewEmails";
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

  const cancelledBy = newStatus === "cancelled_by_candidate" ? "candidate" : "client";
  if (emailData) await sendCancellationEmails(emailData, cancelledBy);
  else console.error(`[interviews/cancel] cancelled ${bookingId} but could not load email data`);

  return NextResponse.json({ status: newStatus });
}
