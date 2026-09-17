import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertFootageAccess } from "@/lib/adminRecordings";
import { recordAdminAction } from "@/lib/adminAudit";

/**
 * GET /api/admin/recordings/session/[id] — the files in one proctor session,
 * as short-lived signed URLs.
 *
 * Called when someone opens a session in the recordings library, not when the
 * page loads: a signed URL is a bearer credential for webcam footage, so one
 * is minted only for a session a person actually asked to watch, it lasts an
 * hour, and the asking is written to the audit log. "Who has watched this
 * candidate's recording" should be a question the panel can answer.
 *
 * Video is stored as numbered MediaRecorder slices of ONE stream — only
 * chunk-00000 carries the WebM header, so the slices are returned in order
 * for the player to join, and any gap in the numbering is reported rather
 * than left for the player to choke on halfway through.
 */

const BUCKET = "proctor-recordings";
const URL_TTL_SECONDS = 60 * 60;

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

interface Stored { name: string; size: number }

/** storage.list() pages at `limit`; a long session has several hundred files. */
async function listAll(db: SupabaseClient, prefix: string): Promise<Stored[] | null> {
  const out: Stored[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db.storage.from(BUCKET)
      .list(prefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
    if (error || !data) return null;
    for (const f of data) {
      if (f.id === null) continue; // a nested folder, not a file
      out.push({ name: f.name, size: Number((f.metadata as { size?: number } | null)?.size ?? 0) });
    }
    if (data.length < 100) return out;
  }
}

async function sign(db: SupabaseClient, paths: string[]): Promise<Map<string, string> | null> {
  const urls = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 200) {
    const batch = paths.slice(i, i + 200);
    const { data, error } = await db.storage.from(BUCKET).createSignedUrls(batch, URL_TTL_SECONDS);
    if (error || !data) return null;
    for (const d of data) if (d.path && d.signedUrl) urls.set(d.path, d.signedUrl);
  }
  return urls;
}

const indexOf = (name: string) => {
  const m = name.match(/-(\d+)\.[a-z0-9]+$/i);
  return m ? parseInt(m[1], 10) : -1;
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await assertFootageAccess();
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const db = admin();

  const { data: session, error } = await db
    .from("proctor_sessions")
    .select("id, candidate_id, storage_prefix, session_kind, video_deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not read the session." }, { status: 500 });
  if (!session) return NextResponse.json({ error: "No such session." }, { status: 404 });

  const prefix = session.storage_prefix as string;
  const [video, frames] = await Promise.all([listAll(db, `${prefix}/video`), listAll(db, `${prefix}/frames`)]);
  if (!video || !frames) return NextResponse.json({ error: "Could not list the recording." }, { status: 500 });

  const urls = await sign(db, [
    ...video.map((f) => `${prefix}/video/${f.name}`),
    ...frames.map((f) => `${prefix}/frames/${f.name}`),
  ]);
  if (!urls) return NextResponse.json({ error: "Could not sign the recording." }, { status: 500 });

  const chunks = video
    .map((f) => ({ n: indexOf(f.name), size: f.size, url: urls.get(`${prefix}/video/${f.name}`) ?? null }))
    .filter((c): c is { n: number; size: number; url: string } => c.n >= 0 && c.url !== null)
    .sort((a, b) => a.n - b.n);

  const frameList = frames
    .map((f) => ({ n: indexOf(f.name), url: urls.get(`${prefix}/frames/${f.name}`) ?? null }))
    .filter((c): c is { n: number; url: string } => c.n >= 0 && c.url !== null)
    .sort((a, b) => a.n - b.n);

  // Slice numbers that should exist and do not. Everything after the first
  // gap is a continuation of bytes that are missing, and will not decode.
  const present = new Set(chunks.map((c) => c.n));
  const last = chunks.length ? chunks[chunks.length - 1].n : -1;
  const missingChunks: number[] = [];
  for (let n = 0; n <= last; n++) if (!present.has(n)) missingChunks.push(n);

  if (chunks.length + frameList.length > 0) {
    await recordAdminAction({
      actorId: actor.id,
      actorRole: actor.role,
      action: "recording.viewed",
      subjectType: "candidate",
      subjectId: session.candidate_id as string,
      summary: `Opened proctor footage (${session.session_kind}, ${chunks.length} video slices, ${frameList.length} frames)`,
      detail: { sessionId: id, kind: "proctor_footage" },
    });
  }

  return NextResponse.json(
    { chunks, frames: frameList, missingChunks, deletedAt: session.video_deleted_at ?? null, expiresInSeconds: URL_TTL_SECONDS },
    { headers: { "Cache-Control": "no-store" } }
  );
}
