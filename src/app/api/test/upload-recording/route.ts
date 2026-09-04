import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { ownsCandidate } from "@/lib/auth";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const RECORDINGS_BUCKET = "voice-recordings";
/** Answers cap at 70s of webm/opus — 10MB is roomy, not generous. */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const EPH_RE = /^[0-9a-f-]{36}$/;

/**
 * POST /api/test/upload-recording — store one spoken answer mid-test.
 *
 * multipart/form-data: candidateId, attemptId, eph (the question's
 * per-attempt id), audio (webm blob). The file lands at a path the SERVER
 * constructs — the client never chooses storage locations — and submit
 * accepts only paths under the same prefix, so a recording can't point
 * anywhere else. Only open, unexpired attempts accept uploads.
 */
export async function POST(request: Request) {
  const formData = await request.formData();
  const candidateId = formData.get("candidateId");
  const attemptId = formData.get("attemptId");
  const eph = formData.get("eph");
  const audio = formData.get("audio");

  if (
    typeof candidateId !== "string" ||
    typeof attemptId !== "string" ||
    typeof eph !== "string" ||
    !EPH_RE.test(eph) ||
    !(audio instanceof File)
  ) {
    return NextResponse.json({ error: "Missing data" }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Recording is too large" }, { status: 413 });
  }
  if (!(await ownsCandidate(candidateId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const authClient = await createServerClient();
  const { data: aal } = await authClient.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.currentLevel !== aal.nextLevel) { // fail CLOSED: an unreadable AAL is not a satisfied one
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const limited = await enforceRateLimit(
    `assessment-upload:${candidateId}`,
    LIMITS.assessmentUpload
  );
  if (limited) return limited;

  const supabase = getAdminClient();

  // The attempt must be this candidate's, open, and actually contain the
  // ephemeral id — otherwise the bucket becomes free audio hosting.
  const { data: attempt } = await supabase
    .from("test_attempts")
    .select("id, questions, expires_at, submitted_at")
    .eq("id", attemptId)
    .eq("candidate_id", candidateId)
    .maybeSingle();
  if (!attempt || attempt.submitted_at) {
    return NextResponse.json({ error: "No open attempt" }, { status: 409 });
  }
  if (Date.now() > new Date(attempt.expires_at).getTime() + 120_000) {
    return NextResponse.json({ error: "Attempt expired" }, { status: 410 });
  }
  const served = (attempt.questions as { eph: string }[]) || [];
  if (!served.some((s) => s.eph === eph)) {
    return NextResponse.json({ error: "Unknown question" }, { status: 400 });
  }

  const path = `${candidateId}/assessment/${attemptId}/${eph}.webm`;
  const buffer = Buffer.from(await audio.arrayBuffer());
  const { error } = await supabase.storage
    .from(RECORDINGS_BUCKET)
    .upload(path, buffer, { contentType: "audio/webm", upsert: true });
  if (error) {
    console.error("[upload-recording] storage upload failed:", error.message);
    return NextResponse.json({ error: "Upload failed" }, { status: 502 });
  }

  return NextResponse.json({ path });
}
