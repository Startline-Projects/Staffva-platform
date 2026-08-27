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
 * POST /api/test/track-time — per-question time telemetry.
 *
 * Replaces the browser's direct insert into question_time_tracking (revoked in
 * migration 00122). The client only knows per-attempt ephemeral question ids
 * now, so the server translates through the attempt row it stored — which also
 * stamps attempt_id, giving retakes the discriminator the analytics tables
 * never had.
 */
export async function POST(request: Request) {
  const candidateId = await getOwnCandidateId();
  if (!candidateId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { attemptId?: unknown; questionId?: unknown; seconds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { attemptId, questionId, seconds } = body;
  if (
    typeof attemptId !== "string" ||
    typeof questionId !== "string" ||
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    seconds > 3600
  ) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const supabase = getAdminClient();

  const { data: attempt } = await supabase
    .from("test_attempts")
    .select("id, questions")
    .eq("id", attemptId)
    .eq("candidate_id", candidateId)
    .maybeSingle();

  if (!attempt) {
    return NextResponse.json({ error: "Unknown attempt" }, { status: 404 });
  }

  const served = (attempt.questions as { qid: string; eph: string }[]).find(
    (s) => s.eph === questionId
  );
  if (!served) {
    return NextResponse.json({ error: "Unknown question" }, { status: 404 });
  }

  const { error } = await supabase.from("question_time_tracking").insert({
    candidate_id: candidateId,
    question_id: served.qid,
    attempt_id: attempt.id,
    time_spent_seconds: Math.round(seconds),
  });
  if (error) {
    console.error("[track-time] insert failed:", error.message);
    return NextResponse.json({ error: "Could not record" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
