import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { ownsCandidate } from "@/lib/auth";
import { gradeAttempt } from "@/lib/gradeAttempt";

// Grading runs in-request: up to 3 storage downloads + 3 Deepgram calls
// (20s timeout each) + one 60s Claude call. Without this, a platform
// default below ~2 minutes kills the grader mid-flight and strands the
// attempt on the lease.
export const maxDuration = 300;

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/test/submit — submit an assessment attempt.
 *
 * Body: { candidateId, attemptId, answers, writeAnswers?, recordings?, timeRemaining? }
 *   answers:      { [ephId]: displayIndex }   MC selections
 *   writeAnswers: { [ephId]: text }           the writing part
 *   recordings:   { [ephId]: storagePath }    paths /api/test/upload-recording returned
 *
 * The submit CLAIM is atomic (submitted_at IS NULL in the WHERE) so a double
 * submit grades exactly once, and grading runs over the SERVED set — every
 * question the server dealt is graded, unanswered means wrong, the client's
 * display indices are translated through the server-held permutation, and
 * the attempt deadline is enforced with grace for slow networks.
 *
 * Grading itself (MC math + Deepgram + the Claude rubric) lives in
 * lib/gradeAttempt. A vendor failure parks the attempt as grading_failed
 * and returns { pending: true } — /api/test/grade retries it; nothing about
 * the candidate's answers is lost.
 */
/** Everything client-supplied gets a hard shape cap before it is stored —
 * an attempt row is not a junk drawer. */
const EPH_RE = /^[0-9a-f-]{36}$/;
const MAX_KEYS = 40;

export async function POST(request: Request) {
  const { candidateId, attemptId, answers, writeAnswers, recordings, audioFlags, timeRemaining } =
    await request.json();

  if (!candidateId || !attemptId || !answers || typeof answers !== "object") {
    return NextResponse.json({ error: "Missing data" }, { status: 400 });
  }

  // Only the candidate who owns this record may submit their test.
  if (!(await ownsCandidate(candidateId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  // Same MFA rule as the identity/phone routes: a half-signed-in aal1
  // session must not act through the middleware's /api exemption.
  const authClient = await createServerClient();
  const { data: aal } = await authClient.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.currentLevel !== aal.nextLevel) { // fail CLOSED: an unreadable AAL is not a satisfied one
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = getAdminClient();

  const cleanMc: Record<string, number> = {};
  let mcCount = 0;
  for (const [eph, v] of Object.entries(answers as Record<string, unknown>)) {
    if (mcCount >= MAX_KEYS) break;
    if (EPH_RE.test(eph) && typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10) {
      cleanMc[eph] = v;
      mcCount++;
    }
  }

  // Recording paths are CLAIMS about storage locations — accept only paths
  // inside this candidate's own folder for this attempt, or a submitted
  // recording could point at any file in the bucket (someone else's fluent
  // answer included). Grading re-checks the same prefix before download.
  const cleanRecordings: Record<string, string> = {};
  if (recordings && typeof recordings === "object") {
    const prefix = `${candidateId}/assessment/${attemptId}/`;
    for (const [eph, path] of Object.entries(recordings as Record<string, unknown>)) {
      if (Object.keys(cleanRecordings).length >= 6) break;
      if (
        EPH_RE.test(eph) &&
        typeof path === "string" &&
        path.startsWith(prefix) &&
        !path.includes("..")
      ) {
        cleanRecordings[eph] = path;
      }
    }
  }
  const cleanWrite: Record<string, string> = {};
  if (writeAnswers && typeof writeAnswers === "object") {
    for (const [eph, text] of Object.entries(writeAnswers as Record<string, unknown>)) {
      if (Object.keys(cleanWrite).length >= 3) break;
      if (EPH_RE.test(eph) && typeof text === "string") cleanWrite[eph] = text.slice(0, 5000);
    }
  }
  // A listening prompt that failed to PLAY is a broken question — the
  // grader nulls that part instead of scoring silence as a wrong answer.
  const cleanFlags: Record<string, string> = {};
  if (audioFlags && typeof audioFlags === "object") {
    for (const [eph, flag] of Object.entries(audioFlags as Record<string, unknown>)) {
      if (Object.keys(cleanFlags).length >= 3) break;
      if (EPH_RE.test(eph) && flag === "audio_failed") cleanFlags[eph] = "audio_failed";
    }
  }

  // ── The claim ──
  const { data: attempt } = await supabase
    .from("test_attempts")
    .update({
      submitted_at: new Date().toISOString(),
      status: "submitted",
      open_answers: { mc: cleanMc, write: cleanWrite, flags: cleanFlags },
      recordings: cleanRecordings,
    })
    .eq("id", attemptId)
    .eq("candidate_id", candidateId)
    .is("submitted_at", null)
    .select("id, expires_at")
    .maybeSingle();

  if (!attempt) {
    return NextResponse.json(
      { error: "This test attempt was already submitted or does not exist." },
      { status: 409 }
    );
  }

  const GRACE_MS = 120_000;
  if (Date.now() > new Date(attempt.expires_at).getTime() + GRACE_MS) {
    // Terminal, not just refused: without this, the stored answers sat at
    // 'submitted' and one POST /api/test/grade graded them anyway.
    await supabase.from("test_attempts").update({ status: "expired" }).eq("id", attemptId);
    return NextResponse.json(
      { error: "Time expired for this attempt. Please start the test again.", expired: true },
      { status: 410 }
    );
  }

  // Kept for parity with the old contract; grading recomputes everything
  // else it needs from the stored attempt.
  if (typeof timeRemaining === "number") {
    await supabase
      .from("candidates")
      .update({ test_time_remaining_seconds: timeRemaining })
      .eq("id", candidateId);
  }

  const outcome = await gradeAttempt(supabase, candidateId, attemptId);

  if (outcome.status === "graded") {
    return NextResponse.json(outcome.result);
  }
  if (outcome.status === "pending") {
    return NextResponse.json({ pending: true });
  }
  if (outcome.status === "expired") {
    return NextResponse.json(
      { error: "Time expired for this attempt. Please start the test again.", expired: true },
      { status: 410 }
    );
  }
  // "already" right after a successful claim means a concurrent grader beat
  // us to it — report its state honestly.
  return NextResponse.json({ pending: outcome.attemptStatus !== "graded" });
}
