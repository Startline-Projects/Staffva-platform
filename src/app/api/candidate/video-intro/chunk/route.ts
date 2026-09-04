import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * POST /api/candidate/video-intro/chunk?take=<id>&n=<index>
 * Body: raw bytes of one MediaRecorder timeslice.
 *
 * Chunks are uploaded WHILE the candidate is still recording, so by the time
 * they press Stop most of the file is already durable. That is the whole
 * design: the previous implementation did one non-resumable POST of the entire
 * file after recording finished, behind a progress bar that was a setInterval
 * adding 8 every 300ms and clamping at 90 — it reached "90%" in 3.6 seconds and
 * then sat there, measuring nothing, until the upload either resolved or died.
 *
 * Uploads go through this route under the service role rather than straight
 * from the browser. The candidate's session cannot be trusted with a bucket
 * path, and doing it here is what lets the finalize step verify there are no
 * gaps before a take is spent.
 */

const MAX_CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_CHUNKS = 60; // 75s at a 4s timeslice is ~19; 60 is a runaway guard.

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const takeId = req.nextUrl.searchParams.get("take") || "";
  const n = Number(req.nextUrl.searchParams.get("n"));

  // A take id comes from the client, so it is treated as hostile: it becomes a
  // path segment. Anything but a plain UUID is refused rather than sanitised.
  if (!/^[0-9a-f-]{36}$/i.test(takeId)) {
    return NextResponse.json({ error: "Bad take" }, { status: 400 });
  }
  if (!Number.isInteger(n) || n < 0 || n >= MAX_CHUNKS) {
    return NextResponse.json({ error: "Bad chunk index" }, { status: 400 });
  }

  const body = Buffer.from(await req.arrayBuffer());
  if (body.length === 0) return NextResponse.json({ ok: true, n });
  if (body.length > MAX_CHUNK_BYTES) {
    return NextResponse.json({ error: "Chunk too large" }, { status: 413 });
  }

  const db = admin();
  const { data: candidate } = await db
    .from("candidates")
    .select("id, video_intro_takes_used, video_intro_takes_allowed")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!candidate) return NextResponse.json({ error: "No candidate profile" }, { status: 404 });

  // Refuse early rather than let someone fill storage with chunks for a take
  // that finalize will reject anyway.
  if (candidate.video_intro_takes_used >= candidate.video_intro_takes_allowed) {
    return NextResponse.json({ error: "No takes remaining" }, { status: 409 });
  }

  const path = `${candidate.id}/intro/${takeId}/chunk-${String(n).padStart(3, "0")}.webm`;
  const { error } = await db.storage
    .from("video-intros")
    .upload(path, body, { contentType: "video/webm", upsert: true });

  if (error) {
    console.error("[video-chunk] upload failed:", error.message);
    // 5xx so the client's retry queue picks it up. Nothing is lost: the client
    // holds the blob until this returns 200.
    return NextResponse.json({ error: "Chunk upload failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, n });
}
