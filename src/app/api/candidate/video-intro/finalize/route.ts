import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * POST /api/candidate/video-intro/finalize
 * Body: { takeId, chunkCount, durationMs, sections }
 *
 * Verifies every chunk arrived, joins them into one file, and only then spends
 * a take. That order is the point: a take is spent against a recording that is
 * durably stored, so an upload that failed costs the candidate nothing.
 *
 * Why concatenating raw chunks is valid here and would not be for four separate
 * recordings: chunks from a SINGLE MediaRecorder are byte-slices of one
 * continuous WebM stream and rejoin into exactly the original file. Four
 * separate recorder runs would each carry their own EBML header, and a naive
 * join produces a file players stop reading at the end of the first segment —
 * an intro that plays only "Tell us who you are". That is why the recorder
 * takes one continuous 75-second pass and the four prompts are UI over its
 * clock, not four recordings.
 */

const MAX_CHUNKS = 60;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

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

  const body = await req.json().catch(() => ({}));
  const { takeId, chunkCount, durationMs, sections } = body as {
    takeId?: string; chunkCount?: number; durationMs?: number;
    sections?: { index: number; prompt: string; start_ms: number }[];
  };

  if (!takeId || !/^[0-9a-f-]{36}$/i.test(takeId)) {
    return NextResponse.json({ error: "Bad take" }, { status: 400 });
  }
  if (!Number.isInteger(chunkCount) || chunkCount! < 1 || chunkCount! > MAX_CHUNKS) {
    return NextResponse.json({ error: "Bad chunk count" }, { status: 400 });
  }

  const db = admin();
  const { data: candidate } = await db
    .from("candidates")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!candidate) return NextResponse.json({ error: "No candidate profile" }, { status: 404 });

  const prefix = `${candidate.id}/intro/${takeId}`;

  // Every chunk, in order, with no gaps. A missing chunk means a hole in the
  // middle of the video, and publishing that would be worse than asking for
  // the take again — so the take is NOT spent and the client is told which
  // parts are still outstanding.
  const { data: listed, error: listErr } = await db.storage.from("video-intros").list(prefix);
  if (listErr) {
    return NextResponse.json({ error: "Could not read your recording" }, { status: 502 });
  }
  const present = new Set((listed ?? []).map((o) => o.name));
  const missing: number[] = [];
  for (let i = 0; i < chunkCount!; i++) {
    if (!present.has(`chunk-${String(i).padStart(3, "0")}.webm`)) missing.push(i);
  }
  if (missing.length) {
    return NextResponse.json(
      { error: "Some parts haven't finished uploading", missing },
      { status: 409 }
    );
  }

  // Join in order.
  const parts: Buffer[] = [];
  let total = 0;
  for (let i = 0; i < chunkCount!; i++) {
    const name = `${prefix}/chunk-${String(i).padStart(3, "0")}.webm`;
    const { data: blob, error } = await db.storage.from("video-intros").download(name);
    if (error || !blob) {
      return NextResponse.json({ error: "Could not assemble your recording" }, { status: 502 });
    }
    const buf = Buffer.from(await blob.arrayBuffer());
    total += buf.length;
    if (total > MAX_TOTAL_BYTES) {
      return NextResponse.json({ error: "Recording is too large" }, { status: 413 });
    }
    parts.push(buf);
  }

  const finalPath = `${candidate.id}/intro/${takeId}.webm`;
  const { error: upErr } = await db.storage
    .from("video-intros")
    .upload(finalPath, Buffer.concat(parts), {
      contentType: "video/webm",
      upsert: true,
    });
  if (upErr) {
    console.error("[video-finalize] upload failed:", upErr.message);
    return NextResponse.json({ error: "Could not save your recording" }, { status: 502 });
  }

  // Spend the take. Only now, and only once — the RPC takes SELECT FOR UPDATE
  // and refuses when none are left.
  const { data: remaining, error: rpcErr } = await db.rpc("consume_video_take", {
    p_candidate_id: candidate.id,
    p_url: finalPath,
    p_duration_ms: Number.isFinite(durationMs) ? Math.round(durationMs as number) : null,
    p_sections: Array.isArray(sections) ? sections : null,
  });
  if (rpcErr) {
    // The file is stored but the take was refused — almost always "no takes
    // remaining" from a double-tap on Finish. Say so plainly rather than
    // leaving the candidate looking at a spinner.
    const noTakes = /No takes remaining/i.test(rpcErr.message);
    return NextResponse.json(
      { error: noTakes ? "You've used both takes." : "Could not save your recording" },
      { status: noTakes ? 409 : 500 }
    );
  }

  // Tidy the chunks. Best effort — a leftover chunk costs storage, not
  // correctness, and failing the request here would tell a candidate their
  // saved recording did not save.
  await db.storage
    .from("video-intros")
    .remove(Array.from({ length: chunkCount! }, (_, i) =>
      `${prefix}/chunk-${String(i).padStart(3, "0")}.webm`))
    .catch(() => {});

  return NextResponse.json({ ok: true, takesRemaining: remaining ?? 0 });
}
