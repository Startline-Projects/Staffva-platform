import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { interviewAdminClient } from "@/lib/interviewBookingData";
import { icsText } from "@/lib/ics";
import { maskContact } from "@/lib/contactMask";

/**
 * GET /api/interviews/[id]/ics — the calendar file for one booking.
 *
 * Atlas puts "Add to calendar" on every upcoming card. We already generate
 * iCalendar for the booking emails, so the only thing missing was a way to
 * ask for it again — without this the button would have been decoration.
 *
 * Scoped to the two people the interview belongs to. The file names the other
 * party and the time, so it is not something to serve on a guessable id.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Typed by hand — the concatenated select defeats supabase-js inference.
  type BookingRow = {
    id: string;
    starts_at: string;
    duration_minutes: number | null;
    status: string;
    client_id: string;
    candidate_id: string;
    candidates: { display_name?: string } | null;
    clients: { company_name?: string; full_name?: string } | null;
  };

  const admin = interviewAdminClient();
  const { data: bookingRaw } = await admin
    .from("interview_bookings")
    .select(
      "id, starts_at, duration_minutes, status, client_id, candidate_id, " +
      "candidates(display_name), clients(company_name, full_name)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!bookingRaw) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const booking = bookingRaw as unknown as BookingRow;

  // Either side may download it; nobody else may.
  const [{ data: client }, { data: candidate }] = await Promise.all([
    admin.from("clients").select("id").eq("user_id", user.id).maybeSingle(),
    admin.from("candidates").select("id").eq("user_id", user.id).maybeSingle(),
  ]);
  const isClient = !!client && client.id === booking.client_id;
  const isCandidate = !!candidate && candidate.id === booking.candidate_id;
  if (!isClient && !isCandidate) {
    return NextResponse.json({ error: "Not your interview" }, { status: 403 });
  }

  const cand = booking.candidates;
  const cl = booking.clients;
  // Masked, like every other client-facing render of this column. A
  // display_name reading "Ana WhatsApp +63 917 555 1234" would otherwise walk
  // straight past the pre-hire contact boundary and into the client's
  // calendar — and the same in reverse for company_name.
  const other = maskContact(
    (isClient
      ? cand?.display_name || "your candidate"
      : cl?.company_name || cl?.full_name || "the client")
  );

  // A cancelled booking still gets a file — a CANCEL, so the calendar removes
  // the event rather than leaving a ghost the client keeps seeing.
  const cancelled = String(booking.status).startsWith("cancelled");
  const body = icsText(
    {
      bookingId: booking.id,
      startsAt: new Date(booking.starts_at),
      durationMinutes: booking.duration_minutes || 30,
      summary: `StaffVA interview with ${other}`,
      description: "Join from your StaffVA interviews page.",
      attendeeEmail: user.email || "",
      // Above the invite email's 0 so a calendar applies this over it, and
      // BELOW sendCancellationEmails' own CANCEL sequence — a download that
      // matched it would let a later cancellation be dropped by clients that
      // require a strictly greater SEQUENCE.
      sequence: cancelled ? 3 : 1,
    },
    cancelled ? "CANCEL" : "REQUEST"
  );

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="staffva-interview.ics"',
      "Cache-Control": "no-store",
    },
  });
}
