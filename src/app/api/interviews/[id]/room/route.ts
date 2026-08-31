import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { interviewAdminClient } from "@/lib/interviewBookingData";
import {
  dailyConfigured,
  ensureInterviewRoom,
  mintMeetingToken,
  JOIN_EARLY_MS,
  OVERRUN_MS,
} from "@/lib/daily";

/**
 * POST /api/interviews/[id]/room — hand the viewer their way into the call.
 *
 * Everything the room's security rests on happens here, server-side: party
 * check, consent check, time window, then a private room and a token pinned
 * to that room, this person, and a hard expiry. The browser receives only
 * what it needs to join — never the API key, never the other party's token.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const admin = interviewAdminClient();
  const { data: b } = await admin
    .from("interview_bookings")
    .select(
      "id, candidate_id, client_id, starts_at, duration_minutes, status, room_name, room_url, client_consented_at, candidate_consented_at"
    )
    .eq("id", id)
    .single();
  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [{ data: cand }, { data: cl }] = await Promise.all([
    admin
      .from("candidates")
      .select("user_id, display_name, full_name")
      .eq("id", b.candidate_id)
      .single(),
    admin.from("clients").select("user_id, full_name, company_name").eq("id", b.client_id).single(),
  ]);

  const viewerRole =
    cl?.user_id === user.id ? "client" : cand?.user_id === user.id ? "candidate" : null;
  if (!viewerRole) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (b.status !== "booked") {
    return NextResponse.json({ error: "This interview is no longer active." }, { status: 409 });
  }

  const myConsent = viewerRole === "client" ? b.client_consented_at : b.candidate_consented_at;
  if (!myConsent) {
    return NextResponse.json(
      { error: "Agree to the recording notice first." },
      { status: 403 }
    );
  }

  const startsMs = new Date(b.starts_at).getTime();
  const duration = b.duration_minutes || 30;
  const endMs = startsMs + duration * 60_000;
  const now = Date.now();
  if (now < startsMs - JOIN_EARLY_MS) {
    return NextResponse.json(
      { error: "The room opens 15 minutes before the interview." },
      { status: 425 }
    );
  }
  if (now > endMs + OVERRUN_MS) {
    return NextResponse.json({ error: "This interview time has passed." }, { status: 410 });
  }

  if (!dailyConfigured()) {
    return NextResponse.json(
      { error: "Video calls aren't available right now — we're on it." },
      { status: 503 }
    );
  }

  // Provision once; both parties racing converge on the same deterministic
  // room, and the stored row saves the vendor round-trip next time.
  let room = b.room_name && b.room_url ? { name: b.room_name, url: b.room_url } : null;
  if (!room) {
    room = await ensureInterviewRoom({
      id: b.id,
      startsAt: new Date(b.starts_at),
      durationMinutes: duration,
    });
    if (room) {
      // If the DB doesn't know the room exists, nobody may enter it: a
      // recorded call in a room the pipeline can't discover would later be
      // swept as a no-show and its consented recording silently aged out.
      const { error: roomWriteError } = await admin
        .from("interview_bookings")
        .update({ room_name: room.name, room_url: room.url })
        .eq("id", b.id);
      if (roomWriteError) {
        return NextResponse.json(
          { error: "We couldn't start the video room — try again in a moment." },
          { status: 502 }
        );
      }
    }
  }
  if (!room) {
    return NextResponse.json(
      { error: "We couldn't start the video room — try again in a moment." },
      { status: 502 }
    );
  }

  const userName =
    viewerRole === "client"
      ? cl?.company_name || cl?.full_name || "Client"
      : cand?.display_name || cand?.full_name || "Candidate";

  const token = await mintMeetingToken({
    roomName: room.name,
    userName,
    startsRecording: viewerRole === "client",
    expUnix: Math.floor((endMs + OVERRUN_MS) / 1000),
    bookingId: b.id,
  });
  if (!token) {
    return NextResponse.json(
      { error: "We couldn't start the video room — try again in a moment." },
      { status: 502 }
    );
  }

  // Join evidence, stamped once: holding a token is what "showed up" means.
  // The token must not outrun the evidence — this stamp is the sole input
  // to completed-vs-no_show, so a failed write refuses the join (the call
  // UI renders a retry, and the .is-null guard keeps retries idempotent).
  const joinColumn = viewerRole === "client" ? "client_joined_at" : "candidate_joined_at";
  const { error: stampError } = await admin
    .from("interview_bookings")
    .update({ [joinColumn]: new Date().toISOString() })
    .eq("id", b.id)
    .is(joinColumn, null);
  if (stampError) {
    console.error("[interview-room] join stamp failed", b.id, joinColumn, stampError.message);
    return NextResponse.json(
      { error: "We couldn't start the video room — try again in a moment." },
      { status: 502 }
    );
  }

  return NextResponse.json({ url: room.url, token });
}
