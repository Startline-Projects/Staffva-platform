import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { interviewAdminClient } from "@/lib/interviewBookingData";
import { maskContact } from "@/lib/contactMask";
import { computeVisibility } from "@/lib/candidateVisibility";

/**
 * GET /api/client/interviews — every interview this client has, all statuses.
 *
 * The existing /api/interviews returns only the next ten BOOKED ones for
 * either side, which is what the dashboard cards need and not what an
 * interviews page needs. This one is client-scoped and keeps the cancelled
 * and completed rows, because the story of an interview that was moved or
 * called off is the part a client actually goes looking for.
 *
 * Everything the page shows is a column or derived from one. Atlas's version
 * of this screen invents per-candidate star ratings, an interview-type
 * taxonomy (Initial/Final), a written agenda, actual call durations
 * ("Completed · 47 min"), client notes, and an "awaiting confirmation" state
 * with proposed time windows. None of those exist here: bookings are
 * confirmed the moment they are made, duration_minutes is fixed at 30 by a
 * CHECK constraint, and nothing records how long a call ran.
 */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const admin = interviewAdminClient();
  const { data: client, error: clientErr } = await admin
    .from("clients").select("id").eq("user_id", user.id).maybeSingle();
  if (clientErr) {
    return NextResponse.json({ error: "Could not load your interviews." }, { status: 500 });
  }
  if (!client) return NextResponse.json({ error: "Not a client account" }, { status: 403 });

  const { data: rows, error } = await admin
    .from("interview_bookings")
    .select(
      "id, candidate_id, starts_at, duration_minutes, status, cancelled_at, cancel_reason, " +
      "rescheduled_from, room_name, created_at, client_joined_at, candidate_joined_at, " +
      "candidates(id, display_name, country, role_category, profile_photo_url, " +
      "admin_status, permanently_blocked, id_verification_status, id_verification_due_at, " +
      "lock_status, availability_status, availability_last_updated_at, created_at)"
    )
    .eq("client_id", client.id)
    .order("starts_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[client/interviews] read failed:", error.message);
    return NextResponse.json({ error: "Could not load your interviews." }, { status: 500 });
  }

  type Row = {
    id: string;
    candidate_id: string;
    starts_at: string;
    duration_minutes: number | null;
    status: string;
    cancelled_at: string | null;
    cancel_reason: string | null;
    rescheduled_from: string | null;
    room_name: string | null;
    created_at: string;
    client_joined_at: string | null;
    candidate_joined_at: string | null;
    candidates: Record<string, unknown> | null;
  };
  const bookings = (rows ?? []) as unknown as Row[];

  const now = Date.now();
  const interviews = bookings.map((b) => {
    const start = new Date(b.starts_at).getTime();
    const mins = b.duration_minutes || 30;
    const end = start + mins * 60_000;
    const cancelled = b.status.startsWith("cancelled");

    const cand = b.candidates;
    let withdrawn: string | null = null;
    if (cand) {
      const vis = computeVisibility(cand);
      withdrawn = cand.permanently_blocked
        ? "This account has been closed."
        : cand.admin_status !== "approved"
          ? "No longer listed on StaffVA."
          : !vis.searchable
            ? "Temporarily hidden from search."
            : null;
    }

    // What we can honestly say happened, from the status enum plus the join
    // stamps 00138 added — NOT from the clock.
    //
    // The first draft labelled every past booking "Completed", which was
    // wrong in three ways at once: 'no_show' rows are written by the
    // transcripts cron and would have read as completed; a row stays 'booked'
    // for at least 50 minutes after the end (and forever if DAILY_API_KEY is
    // unset or the cron gives up), which is the NORMAL state after an
    // interview; and a booking nobody attended looked identical to one that
    // ran. All the clock proves is that the time passed.
    const bothJoined = !!b.client_joined_at && !!b.candidate_joined_at;
    const outcome =
      b.status === "completed" || (b.status === "booked" && now > end && bothJoined)
        ? "took_place"
        : b.status === "no_show"
          ? "no_show"
          : b.status === "booked" && now > end
            ? "time_passed"
            : null;

    return {
      id: b.id,
      startsAt: b.starts_at,
      durationMinutes: mins,
      status: b.status,
      // Derived, never stored: three buckets from one timestamp and a status.
      bucket: cancelled ? "cancelled" : now > end ? "past" : "upcoming",
      outcome,
      // Whether EITHER side has a join stamp — enough to say a call started
      // without claiming both sat through it.
      anyoneJoined: !!b.client_joined_at || !!b.candidate_joined_at,
      cancelledAt: b.cancelled_at,
      // Who called it off is a real column value, not a guess.
      cancelledBy: b.status === "cancelled_by_client" ? "client" : b.status === "cancelled_by_candidate" ? "candidate" : null,
      // Free text the other party wrote about this client's own interview.
      cancelReason: b.cancel_reason ? maskContact(b.cancel_reason) : null,
      // Set for the first time by reschedule_interview — this column existed
      // for months with no writer at all.
      rescheduledFrom: b.rescheduled_from,
      hasRoom: !!b.room_name,
      candidate: cand
        ? {
            id: cand.id as string,
            withdrawn,
            displayName: maskContact(String(cand.display_name ?? "")) || "Candidate",
            country: withdrawn ? null : (cand.country as string | null),
            roleCategory: withdrawn ? null : (cand.role_category as string | null),
            photo: withdrawn ? null : (cand.profile_photo_url as string | null),
          }
        : null,
    };
  });

  // Which bookings were moved TO something else, so a cancelled card can say
  // "moved to a later time" instead of implying it simply fell through.
  const movedFrom = new Set(
    bookings.map((b) => b.rescheduled_from).filter((x): x is string => !!x)
  );

  return NextResponse.json({
    interviews: interviews.map((i) => ({ ...i, wasMoved: movedFrom.has(i.id) })),
    truncated: bookings.length >= 200,
  });
}
