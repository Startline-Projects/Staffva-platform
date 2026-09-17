import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertFootageAccess } from "@/lib/adminRecordings";
import { recordAdminAction } from "@/lib/adminAudit";

/**
 * GET /api/admin/recordings/interview-audio/[id] — a candidate's spoken
 * answers from one Interview 1 attempt, as short-lived signed URLs.
 *
 * Interview 1 uploads one file per question to
 *   voice-recordings/<candidate>/interview1/<ai_interview_id>/<question>.webm
 * and nothing in the database records that they exist, so the bucket is
 * listed directly. They are returned in the order they were recorded, which
 * is the order the interview ran.
 *
 * Same rule as the footage route: signed on request, not on page load, and
 * the request is audited.
 */

const BUCKET = "voice-recordings";
const URL_TTL_SECONDS = 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** "conflict-3-followup" → "Conflict 3 — follow-up" */
function labelFor(file: string): string {
  const stem = file.replace(/\.[a-z0-9]+$/i, "");
  const followup = /-followup$/.test(stem);
  const words = stem.replace(/-followup$/, "").split("-");
  const text = words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
  return followup ? `${text} — follow-up` : text;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await assertFootageAccess();
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad interview id." }, { status: 400 });

  const db = admin();
  const { data: interview, error } = await db
    .from("ai_interviews").select("id, candidate_id").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not read the interview." }, { status: 500 });

  // The answers can outlive the interview row. The library files those too,
  // and passes the candidate it found them under.
  const fallback = req.nextUrl.searchParams.get("candidate");
  const candidateId = (interview?.candidate_id as string | undefined) ?? (fallback && UUID.test(fallback) ? fallback : null);
  if (!candidateId) return NextResponse.json({ error: "No such interview." }, { status: 404 });

  const prefix = `${candidateId}/interview1/${id}`;
  const { data: listed, error: listErr } = await db.storage.from(BUCKET)
    .list(prefix, { limit: 200, sortBy: { column: "created_at", order: "asc" } });
  if (listErr || !listed) return NextResponse.json({ error: "Could not list the answers." }, { status: 500 });

  const stored = listed.filter((f) => f.id !== null);
  const paths = stored.map((f) => `${prefix}/${f.name}`);
  const signed = paths.length
    ? await db.storage.from(BUCKET).createSignedUrls(paths, URL_TTL_SECONDS)
    : { data: [], error: null };
  if (signed.error || !signed.data) return NextResponse.json({ error: "Could not sign the answers." }, { status: 500 });
  const urlByPath = new Map(signed.data.map((d) => [d.path, d.signedUrl]));

  const files = stored.map((f) => {
    const size = Number((f.metadata as { size?: number } | null)?.size ?? 0);
    return {
      name: f.name,
      label: labelFor(f.name),
      size,
      recordedAt: f.created_at ?? null,
      // A zero-byte answer is a recording that captured nothing. It gets no
      // URL: a player that loads and sits silent reads as "they said nothing".
      url: size > 0 ? urlByPath.get(`${prefix}/${f.name}`) ?? null : null,
    };
  });

  if (files.some((f) => f.url)) {
    await recordAdminAction({
      actorId: actor.id,
      actorRole: actor.role,
      action: "recording.viewed",
      subjectType: "candidate",
      subjectId: candidateId,
      summary: `Opened Interview 1 answer audio (${files.filter((f) => f.url).length} recordings)`,
      detail: { interviewId: id, kind: "interview1_audio" },
    });
  }

  return NextResponse.json({ files, expiresInSeconds: URL_TTL_SECONDS }, { headers: { "Cache-Control": "no-store" } });
}
