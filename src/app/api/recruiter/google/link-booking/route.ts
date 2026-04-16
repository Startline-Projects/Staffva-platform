import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const token = authHeader.replace("Bearer ", "");

  const { data: { user } } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ).auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || (profile.role !== "recruiter" && profile.role !== "recruiting_manager")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { bookingId, candidateId } = await req.json();
  if (!bookingId || !candidateId) {
    return NextResponse.json({ error: "bookingId and candidateId are required" }, { status: 400 });
  }

  const { data: booking } = await admin
    .from("calendar_unmatched_bookings")
    .select("id, event_id, event_start")
    .eq("id", bookingId)
    .eq("recruiter_id", user.id)
    .single();

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  const { error: updateErr } = await admin
    .from("candidates")
    .update({
      second_interview_status: "scheduled",
      second_interview_scheduled_at: booking.event_start,
      google_calendar_event_id: booking.event_id,
    })
    .eq("id", candidateId)
    .eq("assigned_recruiter", user.id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await admin
    .from("calendar_unmatched_bookings")
    .delete()
    .eq("id", bookingId);

  return NextResponse.json({ success: true });
}
