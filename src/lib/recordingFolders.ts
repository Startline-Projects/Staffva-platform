/**
 * Filing recordings into folders: person → assessment → attempt.
 *
 * Pure on purpose. Everything here is a decision about where a recording
 * belongs, and those decisions are the part worth being able to run against
 * real rows without a session, a bucket or a browser. The loaders in
 * adminRecordings.ts fetch; this files.
 *
 * Three rules carry the weight:
 *
 *  · A folder exists only while something is in it. Proctor footage is deleted
 *    on a schedule — at once when a session reviews clear, seven days after a
 *    human decides a flagged one — so "has recordings" is read from storage,
 *    never from proctor_sessions.chunk_count, which already drifts from the
 *    bucket (14 counted, 15 stored, on a live session).
 *
 *  · Attempts are numbered against EVERY attempt the candidate made, not only
 *    the ones with recordings. "Attempt 2 of 3" has to mean their second try,
 *    or the number is just a row index that changes when footage expires.
 *    Attempts with nothing kept are still listed, muted, with the reason —
 *    so a missing recording reads as "deleted after review", not as a gap
 *    someone has to go and investigate.
 *
 *  · A session is only ever linked to an attempt by evidence. attempt_id is
 *    stamped when a session ENDS cleanly, so every abandoned session — closed
 *    tab, crash, walked away — has none, and those are disproportionately the
 *    ones a reviewer needs. They are placed by start time when exactly one
 *    attempt began within ten minutes, and say so; otherwise they go in
 *    Unsorted rather than being guessed into somebody's Interview 2.
 */

export type FolderKey = "english_test" | "interview1" | "interview2";

export const FOLDER_LABEL: Record<FolderKey, string> = {
  english_test: "English test",
  interview1: "Interview 1",
  interview2: "Interview 2",
};

export const FOLDER_ORDER: FolderKey[] = ["english_test", "interview1", "interview2"];

/** How close a session's start must be to an attempt's to be linked by time. */
const LINK_WINDOW_MS = 10 * 60 * 1000;

// ── inputs ──────────────────────────────────────────────────────────────────

export interface StorageRow {
  candidateId: string;
  bucket: string;
  kind: string;
  refId: string;
  videoChunks: number;
  frames: number;
  audioFiles: number;
  emptyAudioFiles: number;
  bytes: number;
  newest: string | null;
}

export interface SessionRow {
  id: string;
  candidateId: string;
  sessionKind: string;
  attemptId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  reviewStatus: string;
  verdict: {
    categories?: string[]; evidence?: string; confidence?: string;
    /** Written by the decision surface when a person rules on a flagged session. */
    human_decision?: { decided_by_name?: string | null; note?: string | null } | null;
  } | null;
  decidedAt: string | null;
  videoDeletedAt: string | null;
  cameraLostCount: number;
  chunkCount: number;
}

export interface AttemptRow {
  id: string;
  candidateId: string;
  folder: FolderKey;
  createdAt: string;
  status: string | null;
  /** Interviews only. null = not scored. */
  passed: boolean | null;
  score: number | null;
}

// ── outputs ─────────────────────────────────────────────────────────────────

export interface SessionFootage {
  sessionId: string;
  startedAt: string | null;
  endedAt: string | null;
  reviewStatus: string;
  categories: string[];
  evidence: string | null;
  confidence: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  cameraLostCount: number;
  storedChunks: number;
  storedFrames: number;
  /** What proctor_sessions believes; shown only when it disagrees with storage. */
  countedChunks: number;
  bytes: number;
  linkedBy: "attempt" | "start_time" | "none";
}

export interface ExpiredSession {
  sessionId: string;
  reviewStatus: string;
  /** null = the session recorded nothing in the first place. */
  videoDeletedAt: string | null;
}

export interface AttemptFolder {
  key: string;
  attemptId: string | null;
  /** 1-based among all the candidate's attempts of this kind; null if the attempt row is gone. */
  number: number | null;
  of: number;
  startedAt: string | null;
  status: string | null;
  passed: boolean | null;
  score: number | null;
  footage: SessionFootage[];
  audio: { interviewId: string; files: number; emptyFiles: number; bytes: number } | null;
  /** Sessions belonging to this attempt whose footage is gone, and why. */
  expired: ExpiredSession[];
  hasRecordings: boolean;
  newest: string | null;
}

export interface PersonFolders {
  candidateId: string;
  folders: Record<FolderKey, AttemptFolder[]>;
  /** Footage no attempt could be shown to own. */
  unsorted: SessionFootage[];
  awaitingDecision: number;
  bytes: number;
  newest: string | null;
}

// ── filing ──────────────────────────────────────────────────────────────────

const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : ms(a) >= ms(b) ? a : b);

function folderForSession(s: SessionRow, attempt: AttemptRow | undefined): FolderKey | null {
  if (s.sessionKind === "english_test") return "english_test";
  // An interview session alone does not say WHICH interview. Only its attempt does.
  return attempt ? attempt.folder : null;
}

/**
 * The attempt a session belongs to, and how we know.
 * Time-linking is refused when two attempts are equally plausible: a wrong
 * folder is worse than an honest "unsorted".
 */
function resolveAttempt(
  s: SessionRow,
  byId: Map<string, AttemptRow>,
  candidateAttempts: AttemptRow[]
): { attempt: AttemptRow | undefined; linkedBy: SessionFootage["linkedBy"] } {
  if (s.attemptId) {
    const a = byId.get(s.attemptId);
    if (a) return { attempt: a, linkedBy: "attempt" };
  }
  const start = ms(s.startedAt);
  if (Number.isNaN(start)) return { attempt: undefined, linkedBy: "none" };

  const pool = candidateAttempts.filter((a) =>
    s.sessionKind === "english_test" ? a.folder === "english_test" : a.folder !== "english_test"
  );
  const near = pool
    .map((a) => ({ a, d: Math.abs(ms(a.createdAt) - start) }))
    .filter((x) => x.d <= LINK_WINDOW_MS)
    .sort((x, y) => x.d - y.d);

  if (near.length === 0) return { attempt: undefined, linkedBy: "none" };
  // Two attempts begun within the window of each other: only take the nearer
  // when it is clearly nearer (the retry-a-minute-later case). A tie is a guess.
  if (near.length > 1 && near[1].d - near[0].d < 60_000) return { attempt: undefined, linkedBy: "none" };
  return { attempt: near[0].a, linkedBy: "start_time" };
}

export function fileRecordings(
  candidateId: string,
  storage: StorageRow[],
  sessions: SessionRow[],
  attempts: AttemptRow[]
): PersonFolders {
  const mine = {
    storage: storage.filter((r) => r.candidateId === candidateId),
    sessions: sessions.filter((s) => s.candidateId === candidateId),
    attempts: attempts.filter((a) => a.candidateId === candidateId),
  };

  const attemptById = new Map(mine.attempts.map((a) => [a.id, a]));
  const sessionById = new Map(mine.sessions.map((s) => [s.id, s]));

  // Numbering is over all attempts of a kind, recordings or not.
  const ordered: Record<FolderKey, AttemptRow[]> = { english_test: [], interview1: [], interview2: [] };
  for (const a of [...mine.attempts].sort((x, y) => ms(x.createdAt) - ms(y.createdAt))) ordered[a.folder].push(a);

  const made = new Map<string, AttemptFolder>();
  const folderOf = (a: AttemptRow): AttemptFolder => {
    let f = made.get(a.id);
    if (!f) {
      f = {
        key: a.id, attemptId: a.id,
        number: ordered[a.folder].findIndex((x) => x.id === a.id) + 1,
        of: ordered[a.folder].length,
        startedAt: a.createdAt, status: a.status, passed: a.passed, score: a.score,
        footage: [], audio: null, expired: [], hasRecordings: false, newest: null,
      };
      made.set(a.id, f);
    }
    return f;
  };

  const unsorted: SessionFootage[] = [];
  let awaitingDecision = 0;
  let bytes = 0;
  let newest: string | null = null;
  const sessionsWithFootage = new Set<string>();
  // Interview 1 audio whose ai_interviews row no longer exists still belongs
  // in Interview 1 — the upload path says so — it just cannot be numbered.
  const rowless: AttemptFolder[] = [];

  for (const r of mine.storage) {
    bytes += r.bytes;
    newest = later(newest, r.newest);

    if (r.bucket === "voice-recordings") {
      const a = attemptById.get(r.refId);
      const target = a
        ? folderOf(a)
        : (() => {
            const f: AttemptFolder = {
              key: `audio:${r.refId}`, attemptId: null, number: null, of: ordered.interview1.length,
              startedAt: null, status: null, passed: null, score: null,
              footage: [], audio: null, expired: [], hasRecordings: false, newest: null,
            };
            rowless.push(f);
            return f;
          })();
      target.audio = { interviewId: r.refId, files: r.audioFiles, emptyFiles: r.emptyAudioFiles, bytes: r.bytes };
      // A folder holding only zero-byte files holds no recording.
      if (r.audioFiles > r.emptyAudioFiles) target.hasRecordings = true;
      target.newest = later(target.newest, r.newest);
      continue;
    }

    // proctor footage: ref_id is the session
    if (r.videoChunks + r.frames === 0) continue;
    sessionsWithFootage.add(r.refId);
    const s = sessionById.get(r.refId);

    const footage: SessionFootage = {
      sessionId: r.refId,
      startedAt: s?.startedAt ?? null,
      endedAt: s?.endedAt ?? null,
      reviewStatus: s?.reviewStatus ?? "unknown",
      categories: s?.verdict?.categories ?? [],
      evidence: s?.verdict?.evidence ?? null,
      confidence: s?.verdict?.confidence ?? null,
      decidedAt: s?.decidedAt ?? null,
      decidedBy: s?.verdict?.human_decision?.decided_by_name ?? null,
      decisionNote: s?.verdict?.human_decision?.note ?? null,
      cameraLostCount: s?.cameraLostCount ?? 0,
      storedChunks: r.videoChunks,
      storedFrames: r.frames,
      countedChunks: s?.chunkCount ?? 0,
      bytes: r.bytes,
      linkedBy: "none",
    };

    if (s && s.reviewStatus === "flagged" && !s.decidedAt) awaitingDecision += 1;

    if (!s) { unsorted.push(footage); continue; }

    const { attempt, linkedBy } = resolveAttempt(s, attemptById, mine.attempts);
    footage.linkedBy = linkedBy;
    const where = folderForSession(s, attempt);

    if (!attempt || !where) { unsorted.push(footage); continue; }

    const target = folderOf(attempt);
    target.footage.push(footage);
    target.hasRecordings = true;
    target.newest = later(target.newest, r.newest);
  }

  // Sessions whose footage is gone: recorded against their attempt so the
  // absence is explained where someone will look for it.
  for (const s of mine.sessions) {
    if (sessionsWithFootage.has(s.id)) continue;
    const { attempt } = resolveAttempt(s, attemptById, mine.attempts);
    if (!attempt) continue;
    folderOf(attempt).expired.push({
      sessionId: s.id, reviewStatus: s.reviewStatus, videoDeletedAt: s.videoDeletedAt,
    });
  }

  const folders: Record<FolderKey, AttemptFolder[]> = { english_test: [], interview1: [], interview2: [] };
  for (const key of FOLDER_ORDER) {
    const withRecordings = ordered[key].some((a) => made.get(a.id)?.hasRecordings);
    const extra = key === "interview1" ? rowless.filter((f) => f.hasRecordings) : [];
    // The folder exists only while something is in it …
    if (!withRecordings && extra.length === 0) continue;
    // … but once it does, every attempt is listed, so the numbering is whole.
    folders[key] = [
      ...ordered[key].map((a) => {
        const f = folderOf(a);
        f.footage.sort((x, y) => ms(x.startedAt) - ms(y.startedAt));
        return f;
      }),
      ...extra,
    ];
  }

  unsorted.sort((x, y) => ms(x.startedAt) - ms(y.startedAt));
  return { candidateId, folders, unsorted, awaitingDecision, bytes, newest };
}

/** How many attempts in a folder actually hold something. */
export function countWithRecordings(list: AttemptFolder[]): number {
  return list.filter((a) => a.hasRecordings).length;
}
