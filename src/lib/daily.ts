import { createClient } from "@supabase/supabase-js";

/**
 * Server-side wrapper for the Daily.co REST API — interview rooms and the
 * meeting tokens that gate them. Server-only: the API key must never reach a
 * browser, and there is no dashboard allowlist protecting rooms — a private
 * room plus per-participant tokens is the ENTIRE access control, which is
 * why every token here pins room_name and an expiry (a token without
 * room_name opens every room in the domain; one without exp never expires).
 *
 * Failures land in vendor_failures so alert-health surfaces them; callers
 * get null and turn it into an honest "video is down" message, never a
 * silent success.
 */

const BASE = "https://api.daily.co/v1";

// How early a room can be joined, and how long past the scheduled end it
// stays alive before Daily ejects everyone and deletes the room. Interviews
// that run long are fine; rooms that live forever are how a leaked link
// becomes a standing meeting spot.
export const JOIN_EARLY_MS = 15 * 60 * 1000;
export const OVERRUN_MS = 45 * 60 * 1000;

export function dailyConfigured(): boolean {
  return !!process.env.DAILY_API_KEY;
}

async function recordVendorFailure(operation: string, fatal: boolean, message: string, context: Record<string, unknown>) {
  try {
    await createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      .from("vendor_failures")
      .insert({
        app: "platform",
        vendor: "daily",
        operation,
        fatal,
        message: message.slice(0, 2000),
        context,
      });
  } catch (err) {
    console.error("[daily] could not record vendor failure:", err);
  }
}

async function dailyFetch(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.DAILY_API_KEY}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

export interface InterviewRoom {
  name: string;
  url: string;
}

/**
 * Create (or fetch, if a concurrent request won the create) the private room
 * for one booking. Deterministic name — both parties racing to provision
 * converge on the same room.
 */
export async function ensureInterviewRoom(booking: {
  id: string;
  startsAt: Date;
  durationMinutes: number;
}): Promise<InterviewRoom | null> {
  const name = `interview-${booking.id}`;
  const nbf = Math.floor((booking.startsAt.getTime() - JOIN_EARLY_MS) / 1000);
  const exp = Math.floor(
    (booking.startsAt.getTime() + booking.durationMinutes * 60_000 + OVERRUN_MS) / 1000
  );

  try {
    const created = await dailyFetch("/rooms", {
      method: "POST",
      body: JSON.stringify({
        name,
        privacy: "private",
        properties: {
          nbf,
          exp,
          eject_at_room_exp: true,
          enable_recording: "cloud",
          enable_knocking: false,
          enable_screenshare: true,
          enable_chat: true,
          enable_prejoin_ui: true,
        },
      }),
    });

    if (created.ok && typeof created.body.url === "string") {
      return { name, url: created.body.url };
    }

    // The other party's request may have created it a moment ago. Don't key
    // this on the 400 body's exact prose — any create failure is worth one
    // lookup before declaring the room unreachable.
    const existing = await dailyFetch(`/rooms/${name}`);
    if (existing.ok && typeof existing.body.url === "string") {
      return { name, url: existing.body.url };
    }

    await recordVendorFailure(
      "room.create",
      created.status === 401 || created.status === 403,
      `HTTP ${created.status}: ${JSON.stringify(created.body)}`,
      { bookingId: booking.id }
    );
    return null;
  } catch (err) {
    await recordVendorFailure("room.create", false, err instanceof Error ? err.message : String(err), {
      bookingId: booking.id,
    });
    return null;
  }
}

/**
 * Mint one participant's token for one room. NOBODY is a room owner: an
 * owner token keeps stopRecording/eject/mute powers through the daily-js
 * API even with the recording UI hidden, and recording is a property of
 * the interview, not a button either party gets to press. The client's
 * arrival still starts the cloud recording — start_cloud_recording is its
 * own grant and needs no ownership.
 */
export async function mintMeetingToken(opts: {
  roomName: string;
  userName: string;
  startsRecording: boolean;
  expUnix: number;
  bookingId: string;
}): Promise<string | null> {
  try {
    const res = await dailyFetch("/meeting-tokens", {
      method: "POST",
      body: JSON.stringify({
        properties: {
          room_name: opts.roomName,
          user_name: opts.userName.slice(0, 80),
          is_owner: false,
          exp: opts.expUnix,
          enable_recording_ui: false,
          ...(opts.startsRecording ? { start_cloud_recording: true } : {}),
        },
      }),
    });
    if (res.ok && typeof res.body.token === "string") return res.body.token;

    await recordVendorFailure(
      "token.mint",
      res.status === 401 || res.status === 403,
      `HTTP ${res.status}: ${JSON.stringify(res.body)}`,
      { bookingId: opts.bookingId }
    );
    return null;
  } catch (err) {
    await recordVendorFailure("token.mint", false, err instanceof Error ? err.message : String(err), {
      bookingId: opts.bookingId,
    });
    return null;
  }
}

/**
 * Delete a booking's room, if it exists. Called on cancellation: deleting
 * the private room ejects anyone already joined and turns every minted
 * token into a key for a door that no longer exists — which also closes
 * the window where a token minted mid-cancel would still work.
 */
export async function deleteInterviewRoom(roomName: string, bookingId: string): Promise<void> {
  if (!dailyConfigured()) return;
  try {
    const res = await dailyFetch(`/rooms/${roomName}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      await recordVendorFailure("room.delete", false, `HTTP ${res.status}: ${JSON.stringify(res.body)}`, {
        bookingId,
      });
    }
  } catch (err) {
    await recordVendorFailure("room.delete", false, err instanceof Error ? err.message : String(err), {
      bookingId,
    });
  }
}

// ── Recordings + batch transcription ────────────────────────────────────────
// The transcript cron drives these. Note GET /recordings is one of Daily's
// specially throttled endpoints (~2 req/s, 50 per 30s) — callers sweep in
// small sequential batches, never per-request fan-out.

export interface RoomRecordingSegment {
  id: string;
  durationSec: number;
  startTs: number;
}

export interface RoomRecordings {
  /** Every finished recording, oldest first. A call that drops and rejoins
   * leaves several — ALL of them are the interview, not just the newest. */
  finished: RoomRecordingSegment[];
  inProgress: boolean;
}

export async function findRoomRecordings(roomName: string, bookingId: string): Promise<RoomRecordings | null> {
  try {
    const res = await dailyFetch(`/recordings?room_name=${encodeURIComponent(roomName)}&limit=25`);
    if (!res.ok) {
      await recordVendorFailure("recording.list", res.status === 401 || res.status === 403, `HTTP ${res.status}: ${JSON.stringify(res.body)}`, { bookingId });
      return null;
    }
    const rows = Array.isArray(res.body.data) ? (res.body.data as Record<string, unknown>[]) : [];
    const finished = rows
      .filter((r) => r.status === "finished" && typeof r.id === "string")
      .map((r) => ({
        id: r.id as string,
        durationSec: typeof r.duration === "number" ? r.duration : 0,
        startTs: typeof r.start_ts === "number" ? r.start_ts : 0,
      }))
      .sort((a, b) => a.startTs - b.startTs);
    return { finished, inProgress: rows.some((r) => r.status === "in-progress") };
  } catch (err) {
    await recordVendorFailure("recording.list", false, err instanceof Error ? err.message : String(err), { bookingId });
    return null;
  }
}

/** Submit a batch transcription job for a finished recording. Returns the job id. */
export async function submitTranscriptJob(recordingId: string, bookingId: string): Promise<string | null> {
  try {
    const res = await dailyFetch("/batch-processor", {
      method: "POST",
      body: JSON.stringify({
        preset: "transcript",
        inParams: { sourceType: "recordingId", recordingId },
        // Required even when output lands in Daily's own storage — it is the
        // output filename, stored under domain/jobId/transcript/.
        outParams: { s3Config: { s3KeyTemplate: "transcript" } },
      }),
    });
    if (res.ok && typeof res.body.id === "string") return res.body.id;
    await recordVendorFailure("transcript.submit", res.status === 401 || res.status === 403, `HTTP ${res.status}: ${JSON.stringify(res.body)}`, { bookingId, recordingId });
    return null;
  } catch (err) {
    await recordVendorFailure("transcript.submit", false, err instanceof Error ? err.message : String(err), { bookingId, recordingId });
    return null;
  }
}

export interface TranscriptJob {
  status: "submitted" | "processing" | "finished" | "error" | "unknown";
  error: string | null;
}

export async function getTranscriptJob(jobId: string, bookingId: string): Promise<TranscriptJob | null> {
  try {
    const res = await dailyFetch(`/batch-processor/${jobId}`);
    if (!res.ok) {
      await recordVendorFailure("transcript.poll", false, `HTTP ${res.status}: ${JSON.stringify(res.body)}`, { bookingId, jobId });
      return null;
    }
    const status = res.body.status;
    return {
      status:
        status === "submitted" || status === "processing" || status === "finished" || status === "error"
          ? status
          : "unknown",
      error: typeof res.body.error === "string" ? res.body.error : null,
    };
  } catch (err) {
    await recordVendorFailure("transcript.poll", false, err instanceof Error ? err.message : String(err), { bookingId, jobId });
    return null;
  }
}

export interface TranscriptUtterance {
  speaker: number;
  start: number;
  end: number;
  text: string;
}

export interface ParsedTranscript {
  text: string;
  durationSec: number;
  utterances: TranscriptUtterance[];
}

/**
 * The batch processor's json output is Deepgram prerecorded-style: one long
 * word list with per-word speaker ids, no utterances array. Rebuild diarized
 * utterances by grouping consecutive words on speaker.
 */
export function parseDeepgramTranscript(dg: unknown): ParsedTranscript | null {
  const root = dg as {
    metadata?: { duration?: number };
    results?: { channels?: { alternatives?: { transcript?: string; words?: Record<string, unknown>[] }[] }[] };
  };
  const alt = root?.results?.channels?.[0]?.alternatives?.[0];
  if (!alt) return null;
  const text = typeof alt.transcript === "string" ? alt.transcript : "";
  const words = Array.isArray(alt.words) ? alt.words : [];

  const utterances: TranscriptUtterance[] = [];
  for (const w of words) {
    const speaker = typeof w.speaker === "number" ? w.speaker : 0;
    const start = typeof w.start === "number" ? w.start : 0;
    const end = typeof w.end === "number" ? w.end : start;
    const token = typeof w.punctuated_word === "string" ? w.punctuated_word : typeof w.word === "string" ? w.word : "";
    if (!token) continue;
    const last = utterances[utterances.length - 1];
    if (last && last.speaker === speaker) {
      last.text += ` ${token}`;
      last.end = end;
    } else {
      utterances.push({ speaker, start: Math.round(start * 10) / 10, end, text: token });
    }
  }
  for (const u of utterances) u.end = Math.round(u.end * 10) / 10;

  // A silent recording (dead mic, nobody audible) parses to a VALID empty
  // transcript — 'done with nothing said' is a terminal state the safety
  // review can flag, not a malformed payload to retry forever.
  return {
    text,
    durationSec: Math.round(root?.metadata?.duration || 0),
    utterances,
  };
}

/** Fetch and parse a finished job's json transcript via its access link. */
export async function fetchTranscript(jobId: string, bookingId: string): Promise<ParsedTranscript | null> {
  try {
    const res = await dailyFetch(`/batch-processor/${jobId}/access-link`);
    const list = Array.isArray(res.body.transcription) ? (res.body.transcription as Record<string, unknown>[]) : [];
    const jsonLink = list.find((t) => t.format === "json")?.link;
    if (!res.ok || typeof jsonLink !== "string") {
      await recordVendorFailure("transcript.access-link", false, `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 500)}`, { bookingId, jobId });
      return null;
    }
    const file = await fetch(jsonLink, { signal: AbortSignal.timeout(30_000) });
    if (!file.ok) {
      await recordVendorFailure("transcript.download", false, `HTTP ${file.status} fetching transcript json`, { bookingId, jobId });
      return null;
    }
    const parsed = parseDeepgramTranscript(await file.json());
    if (!parsed) {
      await recordVendorFailure("transcript.parse", false, "Transcript json had no recognizable channels/words structure", { bookingId, jobId });
    }
    return parsed;
  } catch (err) {
    await recordVendorFailure("transcript.download", false, err instanceof Error ? err.message : String(err), { bookingId, jobId });
    return null;
  }
}

/**
 * Delete a batch job and its stored output files. Called after the
 * transcript is safely in Postgres — Daily's storage is not our archive.
 * Best-effort: a failure here costs pennies of storage, not correctness.
 */
export async function deleteTranscriptJob(jobId: string): Promise<void> {
  try {
    await dailyFetch(`/batch-processor/${jobId}`, { method: "DELETE" });
  } catch {
    // best-effort
  }
}

/** Delete a cloud recording. 404 counts as deleted. */
export async function deleteRecording(recordingId: string, bookingId: string): Promise<boolean> {
  try {
    const res = await dailyFetch(`/recordings/${recordingId}`, { method: "DELETE" });
    if (res.ok || res.status === 404) return true;
    await recordVendorFailure("recording.delete", false, `HTTP ${res.status}: ${JSON.stringify(res.body)}`, { bookingId, recordingId });
    return false;
  } catch (err) {
    await recordVendorFailure("recording.delete", false, err instanceof Error ? err.message : String(err), { bookingId, recordingId });
    return false;
  }
}

/**
 * One cheap authenticated call, for health checks: does the key work?
 * Returns an error description, or null when healthy.
 */
export async function dailyHealthProbe(): Promise<string | null> {
  if (!dailyConfigured()) return "DAILY_API_KEY is not set";
  try {
    const res = await dailyFetch("/");
    if (res.ok) return null;
    return `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
