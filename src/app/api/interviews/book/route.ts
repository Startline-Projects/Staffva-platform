import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { loadBookingEmailData } from "@/lib/interviewBookingData";
import { sendBookingEmails } from "@/lib/interviewEmails";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

/**
 * POST /api/interviews/book — { candidateId, startsAt }
 *
 * The book_interview RPC (running as the caller, so auth.uid() is real) is
 * still the entire security boundary; this route exists because a browser
 * can't send calendar invites. Email failures never fail the booking — the
 * row is committed, the detail page shows the truth.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Every successful booking emails a candidate; a cancel→rebook loop is the
  // spam vector, so cap attempts per user rather than per IP.
  const limited = await enforceRateLimit(`iv-book:${user.id}`, LIMITS.interviewBook);
  if (limited) return limited;

  let body: { candidateId?: unknown; startsAt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const candidateId = typeof body.candidateId === "string" ? body.candidateId : "";
  const startsAt = typeof body.startsAt === "string" ? body.startsAt : "";
  if (!candidateId || Number.isNaN(Date.parse(startsAt))) {
    return NextResponse.json({ error: "Missing candidateId or startsAt" }, { status: 400 });
  }

  const { data: bookingId, error } = await supabase.rpc("book_interview", {
    p_candidate_id: candidateId,
    p_starts_at: startsAt,
  });
  if (error || !bookingId) {
    return NextResponse.json(
      { error: (error?.message || "Could not book that slot.").replace(/^.*?: /, "") },
      { status: 409 }
    );
  }

  const emailData = await loadBookingEmailData(bookingId as string);
  if (emailData) await sendBookingEmails(emailData);
  else console.error(`[interviews/book] booked ${bookingId} but could not load email data`);

  return NextResponse.json({ id: bookingId });
}
