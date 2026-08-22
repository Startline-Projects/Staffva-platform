import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getOwnCandidateId } from "@/lib/auth";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * PATCH /api/test/anticheat-return
 * Updates a test_events row with the return timestamp and absence duration.
 * Called from the EnglishTest component when the candidate returns to the screen.
 */
export async function PATCH(request: Request) {
  const { event_id, returned_at, absence_duration_seconds } = await request.json();

  if (!event_id || !returned_at || absence_duration_seconds === undefined) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Previously unauthenticated: anyone could rewrite any test_events row by id,
  // e.g. zeroing another candidate's absence durations (or their own) to defeat
  // the anti-cheat lockout. Scope the update to the caller's own events so a
  // foreign event_id simply matches nothing.
  const ownCandidateId = await getOwnCandidateId();
  if (!ownCandidateId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = getAdminClient();

  const { error } = await supabase
    .from("test_events")
    .update({ returned_at, absence_duration_seconds })
    .eq("id", event_id)
    .eq("candidate_id", ownCandidateId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
