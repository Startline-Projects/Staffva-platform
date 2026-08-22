import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ownsCandidate } from "@/lib/auth";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/test/anticheat-check
 * Recalculates a candidate's anti-cheat strike count and max absence duration,
 * then flags them if either lockout rule is met. Does NOT apply the lockout
 * timestamp — that happens only after ID verification passes.
 */
export async function POST(request: Request) {
  const { candidate_id } = await request.json();

  if (!candidate_id) {
    return NextResponse.json({ error: "Missing candidate_id" }, { status: 400 });
  }

  if (!(await ownsCandidate(candidate_id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = getAdminClient();

  // Read all leave-type events for this candidate
  const { data: events, error } = await supabase
    .from("test_events")
    .select("id, absence_duration_seconds")
    .eq("candidate_id", candidate_id)
    .in("event_type", ["mouse_leave", "tab_switch", "fullscreen_exit"]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const strikeCount = events?.length ?? 0;
  const maxAbsenceSeconds = (events ?? []).reduce((max, e) => {
    const dur = e.absence_duration_seconds ?? 0;
    return dur > max ? dur : max;
  }, 0);

  // Evaluate lockout rules (flagging only — no lockout timestamp yet)
  let lockoutTriggered = false;
  let lockoutReason: "four_strikes" | "ten_second_absence" | null = null;

  if (strikeCount >= 4) {
    lockoutTriggered = true;
    lockoutReason = "four_strikes";
  } else if (maxAbsenceSeconds >= 10) {
    lockoutTriggered = true;
    lockoutReason = "ten_second_absence";
  }

  const updatePayload: Record<string, unknown> = {
    anticheat_strike_count: strikeCount,
    anticheat_max_absence_seconds: maxAbsenceSeconds,
  };

  if (lockoutTriggered) {
    updatePayload.anticheat_lockout_triggered = true;
    updatePayload.anticheat_lockout_reason = lockoutReason;
  }

  await supabase
    .from("candidates")
    .update(updatePayload)
    .eq("id", candidate_id);

  return NextResponse.json({
    strike_count: strikeCount,
    max_absence_seconds: maxAbsenceSeconds,
    lockout_triggered: lockoutTriggered,
    lockout_reason: lockoutReason,
  });
}
