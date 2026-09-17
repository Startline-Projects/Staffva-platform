import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  FOLDER_ORDER, countWithRecordings, fileRecordings,
  type AttemptRow, type FolderKey, type PersonFolders, type SessionRow, type StorageRow,
} from "@/lib/recordingFolders";

/**
 * The recordings library: who has anything in storage, and what.
 *
 * Fetching only — every decision about where a recording belongs is in
 * recordingFolders.ts, which is pure and has been run against the production
 * rows. This file's job is to get those rows honestly:
 *
 *  · Storage is the source of truth for "is there a recording", read through
 *    the admin_recording_index function because PostgREST does not expose the
 *    storage schema and list() costs one call per attempt per candidate.
 *  · null means a read failed. An empty list means nothing is stored. The
 *    pages say which; footage that silently fails to load must never render
 *    as "this person has no recordings".
 *
 * Server-only: reads SUPABASE_SERVICE_ROLE_KEY.
 */

export interface PersonCard {
  candidateId: string;
  name: string;
  roleCategory: string | null;
  photoUrl: string | null;
  /** Attempts holding recordings, per folder. A zero means the folder does not exist. */
  counts: Record<FolderKey, number>;
  unsorted: number;
  awaitingDecision: number;
  bytes: number;
  newest: string | null;
}

export interface PersonRecordings {
  person: { id: string; name: string; roleCategory: string | null; photoUrl: string | null; country: string | null };
  filed: PersonFolders;
}

const PAGE = 1000;
const IN_CHUNK = 100;

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * Footage is webcam video of a person sitting an assessment. Talent
 * specialists can approve video intros, but this is not that — it stays with
 * the two roles that can already rule on a flagged session.
 */
export async function assertFootageAccess(): Promise<{ id: string; role: "admin" | "recruiting_manager" } | null> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  if (!user || (role !== "admin" && role !== "recruiting_manager")) return null;
  return { id: user.id, role };
}

async function readStorageIndex(db: SupabaseClient, candidateId: string | null): Promise<StorageRow[] | null> {
  const rows: StorageRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .rpc("admin_recording_index", { p_candidate: candidateId })
      .range(from, from + PAGE - 1);
    if (error || !data) return null;
    for (const r of data as Record<string, unknown>[]) {
      rows.push({
        candidateId: r.candidate_id as string,
        bucket: r.bucket as string,
        kind: r.kind as string,
        refId: r.ref_id as string,
        videoChunks: Number(r.video_chunks ?? 0),
        frames: Number(r.frames ?? 0),
        audioFiles: Number(r.audio_files ?? 0),
        emptyAudioFiles: Number(r.empty_audio_files ?? 0),
        bytes: Number(r.bytes ?? 0),
        newest: (r.newest as string | null) ?? null,
      });
    }
    if (data.length < PAGE) return rows;
  }
}

/** `.in()` goes in the query string; a few hundred uuids is past what gateways accept. */
async function inChunks<T>(ids: string[], read: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[] | null> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await read(ids.slice(i, i + IN_CHUNK));
    if (error || !data) return null;
    out.push(...data);
  }
  return out;
}

async function readSessionsAndAttempts(db: SupabaseClient, candidateIds: string[]) {
  const [sessions, interviews, tests] = await Promise.all([
    inChunks(candidateIds, (ids) => db.from("proctor_sessions")
      .select("id, candidate_id, session_kind, attempt_id, started_at, ended_at, review_status, verdict, decided_at, video_deleted_at, camera_lost_count, chunk_count")
      .in("candidate_id", ids)),
    inChunks(candidateIds, (ids) => db.from("ai_interviews")
      .select("id, candidate_id, kind, created_at, status, passed, overall_score")
      .in("candidate_id", ids)),
    inChunks(candidateIds, (ids) => db.from("test_attempts")
      .select("id, candidate_id, created_at, status")
      .in("candidate_id", ids)),
  ]);
  if (!sessions || !interviews || !tests) return null;

  const sessionRows: SessionRow[] = sessions.map((s) => ({
    id: s.id, candidateId: s.candidate_id, sessionKind: s.session_kind, attemptId: s.attempt_id,
    startedAt: s.started_at, endedAt: s.ended_at, reviewStatus: s.review_status,
    verdict: (s.verdict as SessionRow["verdict"]) ?? null,
    decidedAt: s.decided_at, videoDeletedAt: s.video_deleted_at,
    cameraLostCount: s.camera_lost_count ?? 0, chunkCount: s.chunk_count ?? 0,
  }));

  const attemptRows: AttemptRow[] = [
    ...interviews.map((i): AttemptRow => ({
      id: i.id, candidateId: i.candidate_id,
      // 'behavioral' is Interview 1. Everything else — 'skills', and the
      // pre-split rows where kind is null — is the skills interview.
      folder: i.kind === "behavioral" ? "interview1" : "interview2",
      createdAt: i.created_at, status: i.status, passed: i.passed, score: i.overall_score,
    })),
    ...tests.map((t): AttemptRow => ({
      id: t.id, candidateId: t.candidate_id, folder: "english_test",
      createdAt: t.created_at, status: t.status, passed: null, score: null,
    })),
  ];

  return { sessionRows, attemptRows };
}

const displayName = (c: { display_name: string | null; full_name: string | null }) =>
  c.display_name || c.full_name || "Unnamed candidate";

/** Everyone with at least one recording in storage. null = a read failed. */
export async function loadRecordingIndex(): Promise<PersonCard[] | null> {
  if (!(await assertFootageAccess())) return null;
  const db = serviceClient();

  const storage = await readStorageIndex(db, null);
  if (!storage) return null;

  const candidateIds = [...new Set(storage.map((r) => r.candidateId))];
  if (candidateIds.length === 0) return [];

  const [rows, people] = await Promise.all([
    readSessionsAndAttempts(db, candidateIds),
    inChunks(candidateIds, (ids) => db.from("candidates")
      .select("id, display_name, full_name, role_category, profile_photo_url").in("id", ids)),
  ]);
  if (!rows || !people) return null;
  const personById = new Map(people.map((p) => [p.id as string, p]));

  const cards: PersonCard[] = [];
  for (const id of candidateIds) {
    const filed = fileRecordings(id, storage, rows.sessionRows, rows.attemptRows);
    const counts = Object.fromEntries(
      FOLDER_ORDER.map((k) => [k, countWithRecordings(filed.folders[k])])
    ) as Record<FolderKey, number>;
    // Storage held only zero-byte answers: there is no recording here, so
    // there is no folder.
    if (FOLDER_ORDER.every((k) => counts[k] === 0) && filed.unsorted.length === 0) continue;

    const p = personById.get(id);
    cards.push({
      candidateId: id,
      // A recording whose candidate row is gone is still a recording someone
      // has to be able to find and deal with.
      name: p ? displayName(p) : "Deleted candidate",
      roleCategory: p?.role_category ?? null,
      photoUrl: p?.profile_photo_url ?? null,
      counts,
      unsorted: filed.unsorted.length,
      awaitingDecision: filed.awaitingDecision,
      bytes: filed.bytes,
      newest: filed.newest,
    });
  }

  // Undecided flags first — that is the work — then most recent.
  cards.sort((a, b) =>
    (b.awaitingDecision > 0 ? 1 : 0) - (a.awaitingDecision > 0 ? 1 : 0)
    || (b.newest ?? "").localeCompare(a.newest ?? ""));
  return cards;
}

/** One person's folders. null = a read failed; "not_found" = no such candidate and nothing stored. */
export async function loadPersonRecordings(candidateId: string): Promise<PersonRecordings | "not_found" | null> {
  if (!(await assertFootageAccess())) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(candidateId)) return "not_found";
  const db = serviceClient();

  const [storage, rows, personRes] = await Promise.all([
    readStorageIndex(db, candidateId),
    readSessionsAndAttempts(db, [candidateId]),
    db.from("candidates")
      .select("id, display_name, full_name, role_category, profile_photo_url, country")
      .eq("id", candidateId).maybeSingle(),
  ]);
  if (!storage || !rows || personRes.error) return null;
  if (!personRes.data && storage.length === 0) return "not_found";

  const p = personRes.data;
  return {
    person: {
      id: candidateId,
      name: p ? displayName(p) : "Deleted candidate",
      roleCategory: p?.role_category ?? null,
      photoUrl: p?.profile_photo_url ?? null,
      country: p?.country ?? null,
    },
    filed: fileRecordings(candidateId, storage, rows.sessionRows, rows.attemptRows),
  };
}
