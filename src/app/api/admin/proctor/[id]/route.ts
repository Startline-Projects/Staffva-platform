import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * GET /api/admin/proctor/[id] — one flagged/decided session with signed
 * URLs for every stored frame and video chunk. URLs are minted here with
 * the service role because the bucket is private; 1 hour is enough for a
 * review sitting. The page lazy-loads frames, so minting all of them in one
 * bulk call is cheaper than a signing round-trip per scroll.
 */

const BUCKET = "proctor-recordings";
const SIGNED_URL_TTL = 3600;

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function verifyAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = getAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, full_name, email").eq("id", user.id).single();
  return (profile?.role === "admin" || profile?.role === "recruiting_manager") ? { ...user, adminName: profile.full_name, adminEmail: profile.email } : null;
}

/**
 * Null means "storage would not answer" — distinct from an empty folder,
 * same contract as the cron's listAll. The page shows a retry note instead
 * of pretending the footage is gone.
 */
async function listAll(db: ReturnType<typeof getAdminClient>, prefix: string): Promise<string[] | null> {
  const out: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: 100, offset });
    if (error) return null;
    if (!data || data.length === 0) break;
    out.push(...data.filter((f) => f.name).map((f) => `${prefix}/${f.name}`));
    if (data.length < 100) break;
    offset += 100;
  }
  return out.sort();
}

/**
 * Null means "signing failed", wholesale or partially — same unknown-vs-empty
 * contract as listAll. A signing hiccup must not render as "no footage was
 * stored" on a surface where an admin decides on exactly that premise, and a
 * partially signed chunk list would byte-concatenate into a corrupt video.
 */
async function signAll(db: ReturnType<typeof getAdminClient>, paths: string[]): Promise<{ name: string; url: string }[] | null> {
  if (paths.length === 0) return [];
  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL);
  if (error || !data) return null;
  const signed = data
    .filter((d) => d.signedUrl && d.path)
    .map((d) => ({ name: d.path!.split("/").pop() || d.path!, url: d.signedUrl }));
  if (signed.length !== paths.length) return null;
  return signed;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await params;
  const supabase = getAdminClient();

  const { data: session } = await supabase
    .from("proctor_sessions")
    .select(
      "id, candidate_id, session_kind, attempt_id, storage_prefix, chunk_count, frame_count, camera_lost_count, started_at, ended_at, review_status, verdict, reviewed_at, video_deleted_at, decided_at, review_attempts"
    )
    .eq("id", id)
    .single();
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const { data: candidate } = await supabase
    .from("candidates")
    .select("id, display_name, full_name, email, country, role_category, admin_status")
    .eq("id", session.candidate_id)
    .single();

  if (session.video_deleted_at) {
    return NextResponse.json({ session, candidate: candidate || null, frames: [], chunks: [], footage: "deleted" });
  }

  const [framePaths, chunkPaths] = await Promise.all([
    listAll(supabase, `${session.storage_prefix}/frames`),
    listAll(supabase, `${session.storage_prefix}/video`),
  ]);
  if (framePaths === null || chunkPaths === null) {
    return NextResponse.json({ session, candidate: candidate || null, frames: [], chunks: [], footage: "unavailable" });
  }

  const [frames, chunks] = await Promise.all([signAll(supabase, framePaths), signAll(supabase, chunkPaths)]);
  if (frames === null || chunks === null) {
    return NextResponse.json({ session, candidate: candidate || null, frames: [], chunks: [], footage: "unavailable" });
  }

  return NextResponse.json({ session, candidate: candidate || null, frames, chunks, footage: "present" });
}
