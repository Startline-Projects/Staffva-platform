import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Hard ceilings: a 15-minute test at 10s chunks is ~95 chunks and ~80
// frames; triple headroom, then the tap closes. Uploads beyond the cap are
// dropped (202) rather than erroring the candidate's session — the review
// treats a truncated recording as suspicious, so the cap can't be used to
// hide the end of a session invisibly.
const MAX_CHUNKS = 300;
const MAX_FRAMES = 240;
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_FRAME_BYTES = 400 * 1024;

/** Width/height from a JPEG's SOF marker; null if it isn't a sane JPEG. */
function jpegDimensions(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 12 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/**
 * POST /api/proctor/session/[id]/upload?kind=chunk&n=12
 * POST /api/proctor/session/[id]/upload?kind=frame&n=34
 * Raw body: webm chunk or jpeg frame. Candidate-owned sessions only, while
 * the session is still 'recording'.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const kind = req.nextUrl.searchParams.get("kind");
  const n = parseInt(req.nextUrl.searchParams.get("n") || "", 10);
  if ((kind !== "chunk" && kind !== "frame") || !Number.isInteger(n) || n < 0 || n > 100000) {
    return NextResponse.json({ error: "Bad params" }, { status: 400 });
  }

  const db = admin();
  const { data: session } = await db
    .from("proctor_sessions")
    .select("id, candidate_id, storage_prefix, chunk_count, frame_count, review_status, candidates!inner(user_id)")
    .eq("id", id)
    .single();
  const owner = (session?.candidates as { user_id?: string } | null)?.user_id;
  if (!session || owner !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (session.review_status !== "recording") {
    return NextResponse.json({ error: "Session ended" }, { status: 409 });
  }

  const body = Buffer.from(await req.arrayBuffer());
  const maxBytes = kind === "chunk" ? MAX_CHUNK_BYTES : MAX_FRAME_BYTES;
  if (body.length === 0 || body.length > maxBytes) {
    return NextResponse.json({ error: "Bad size" }, { status: 413 });
  }
  // Frames feed a vision model with hard dimension limits; the 512px
  // geometry is client-side and a crafted huge-but-compressible JPEG would
  // poison every review of this session forever. Validate server-side.
  if (kind === "frame") {
    const dims = jpegDimensions(body);
    if (!dims || dims.w > 1024 || dims.h > 1024 || dims.w < 16 || dims.h < 16) {
      return NextResponse.json({ error: "Bad frame" }, { status: 415 });
    }
  }
  const count = kind === "chunk" ? session.chunk_count : session.frame_count;
  const cap = kind === "chunk" ? MAX_CHUNKS : MAX_FRAMES;
  if (count >= cap) return NextResponse.json({ dropped: true }, { status: 202 });

  const path =
    kind === "chunk"
      ? `${session.storage_prefix}/video/chunk-${String(n).padStart(5, "0")}.webm`
      : `${session.storage_prefix}/frames/frame-${String(n).padStart(5, "0")}.jpg`;

  const { error: upErr } = await db.storage
    .from("proctor-recordings")
    .upload(path, body, {
      contentType: kind === "chunk" ? "video/webm" : "image/jpeg",
      upsert: true, // client retry of the same n overwrites, never duplicates
    });
  if (upErr) return NextResponse.json({ error: "Upload failed" }, { status: 502 });

  await db
    .from("proctor_sessions")
    .update(kind === "chunk" ? { chunk_count: count + 1 } : { frame_count: count + 1 })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
