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
 * POST /api/apply/device-report — measure-only device capability telemetry.
 *
 * Records what enumerateDevices() saw during the device-check step: is a
 * camera present, is a microphone present. No permission prompt is involved,
 * nothing is captured, and NOTHING here gates the candidate — the entire
 * point is to learn the real webcam-availability rate of the funnel BEFORE
 * deciding whether "camera required" excludes 2% of applicants or 20%.
 *
 * camera_present semantics: true/false are real observations; null means the
 * API was unavailable or blocked, which is "unknown", never "no camera".
 */
export async function POST(request: Request) {
  let body: { candidateId?: unknown; cameraPresent?: unknown; micPresent?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { candidateId, cameraPresent, micPresent } = body;
  if (typeof candidateId !== "string") {
    return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });
  }
  if (!(await ownsCandidate(candidateId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const norm = (v: unknown) => (typeof v === "boolean" ? v : null);
  const camera = norm(cameraPresent);

  const supabase = getAdminClient();
  const { error } = await supabase
    .from("candidates")
    .update({
      device_report: {
        camera_present: camera,
        mic_present: norm(micPresent),
        checked_at: new Date().toISOString(),
      },
      // Keep the legacy column in sync where we actually observed something.
      ...(camera !== null ? { has_webcam: camera } : {}),
    })
    .eq("id", candidateId);

  if (error) {
    console.error("[device-report] update failed:", error.message);
    return NextResponse.json({ error: "Could not record" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
