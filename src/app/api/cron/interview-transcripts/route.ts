import { NextRequest, NextResponse } from "next/server";
import { hasCronSecret } from "@/lib/auth";
import { interviewAdminClient } from "@/lib/interviewBookingData";
import {
  dailyConfigured,
  findRoomRecordings,
  submitTranscriptJob,
  getTranscriptJob,
  fetchTranscript,
  deleteTranscriptJob,
  deleteRecording,
  OVERRUN_MS,
  type ParsedTranscript,
} from "@/lib/daily";

/**
 * GET /api/cron/interview-transcripts — every 10 minutes.
 *
 * The pipeline behind the consent notice's promise ("recorded and
 * transcribed"). Sequential phases in small batches, because GET /recordings
 * is Daily's most throttled endpoint:
 *
 *  rescue    reclaim half-claims from a killed run, and give up on rows
 *            stuck "transcribing" for a day
 *  discover  ended interviews with a room → find EVERY finished recording
 *            (a dropped-and-rejoined call leaves several; all of them are
 *            the interview), submit one transcription job per segment
 *  collect   poll the jobs → when all segments finish, store the merged
 *            diarized transcript in Postgres and delete Daily's copies
 *  retire    recordings past the retention window → delete from Daily
 *            (they bill storage per minute until someone deletes them)
 *
 * transcript_status walks: null → transcribing → done, with no_recording
 * and error as terminal detours. Claims are leased (transcript_claimed_at):
 * a crash between claim and job-id write leaves a row the rescue phase
 * returns to null instead of a permanent wedge, and the booking's status
 * only flips to completed once its jobs are safely recorded.
 */

export const dynamic = "force-dynamic";

const RETENTION_DAYS = 30;
const SETTLE_MS = 5 * 60 * 1000; // let recordings finalize after the end
const GIVE_UP_MS = 2 * 60 * 60 * 1000; // no recording 2h after the end = there is none
const LEASE_MS = 30 * 60 * 1000; // 3 cron intervals, far beyond maxDuration
const STUCK_MS = 24 * 60 * 60 * 1000; // batch jobs finish in minutes, not days

interface SegmentRecord {
  recording_id: string;
  job_id: string;
  duration_sec: number;
  start_ts: number;
}

export async function GET(req: NextRequest) {
  if (!hasCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!dailyConfigured()) {
    return NextResponse.json({ error: "DAILY_API_KEY is not set" }, { status: 503 });
  }

  const admin = interviewAdminClient();
  const now = Date.now();
  const stats = { rescued: 0, gaveUp: 0, discovered: 0, noRecording: 0, transcribed: 0, errored: 0, retired: 0 };

  // ── rescue ────────────────────────────────────────────────────────────────
  // A run killed between claiming and writing job ids leaves
  // {transcribing, segments null}; the lease has long expired, so hand the
  // row back to discover.
  const { data: rescued } = await admin
    .from("interview_bookings")
    .update({ transcript_status: null, transcript_claimed_at: null })
    .eq("transcript_status", "transcribing")
    .is("transcript_segments", null)
    .lt("transcript_claimed_at", new Date(now - LEASE_MS).toISOString())
    .select("id");
  stats.rescued = rescued?.length || 0;

  // Jobs submitted a day ago that still aren't collected are not going to
  // finish — stop polling them and let alert-health say so.
  const { data: gaveUp } = await admin
    .from("interview_bookings")
    .update({ transcript_status: "error" })
    .eq("transcript_status", "transcribing")
    .lt("transcript_claimed_at", new Date(now - STUCK_MS).toISOString())
    .select("id");
  stats.gaveUp = gaveUp?.length || 0;

  // ── discover ──────────────────────────────────────────────────────────────
  // Ended interviews (including ones cancelled mid-call — their partial
  // recording is still consented, recorded content) whose room existed and
  // whose pipeline hasn't started.
  const { data: ended } = await admin
    .from("interview_bookings")
    .select("id, starts_at, duration_minutes, status, room_name")
    .in("status", ["booked", "cancelled_by_client", "cancelled_by_candidate"])
    .not("room_name", "is", null)
    .is("transcript_status", null)
    .lt("starts_at", new Date(now - SETTLE_MS - OVERRUN_MS - 30 * 60_000).toISOString())
    .order("starts_at", { ascending: true })
    .limit(10);

  for (const b of ended || []) {
    const endMs = new Date(b.starts_at).getTime() + (b.duration_minutes || 30) * 60_000;
    // Not until the room itself is dead (end + overrun): flipping a booking
    // to 'completed' while the room is open would withdraw the promised
    // rejoin and can dump a live participant onto the wrap-up card.
    if (now < endMs + OVERRUN_MS + SETTLE_MS) continue;

    const rec = await findRoomRecordings(b.room_name as string, b.id);
    if (!rec) continue; // vendor hiccup — retry next run
    if (rec.inProgress) continue; // still recording — the room dies at end+45min

    if (rec.finished.length === 0) {
      if (now > endMs + GIVE_UP_MS) {
        await admin
          .from("interview_bookings")
          .update({ transcript_status: "no_recording" })
          .eq("id", b.id)
          .is("transcript_status", null);
        stats.noRecording++;
      }
      continue;
    }

    // Claim (leased) before submitting so an overlapping run can't
    // double-pay. The booking's status is NOT flipped here — only the
    // success write below may do that, so a failed submit releases a row
    // discover will find again.
    const { data: claimed } = await admin
      .from("interview_bookings")
      .update({
        transcript_status: "transcribing",
        transcript_claimed_at: new Date().toISOString(),
      })
      .eq("id", b.id)
      .is("transcript_status", null)
      .select("id");
    if (!claimed?.length) continue;

    const segments: SegmentRecord[] = [];
    for (const seg of rec.finished) {
      const jobId = await submitTranscriptJob(seg.id, b.id);
      if (!jobId) break;
      segments.push({ recording_id: seg.id, job_id: jobId, duration_sec: seg.durationSec, start_ts: seg.startTs });
    }

    if (segments.length < rec.finished.length) {
      // A submit failed. Withdraw the paid jobs we did start and release
      // the claim fully — next run re-discovers and retries.
      for (const s of segments) await deleteTranscriptJob(s.job_id);
      await admin
        .from("interview_bookings")
        .update({ transcript_status: null, transcript_claimed_at: null })
        .eq("id", b.id)
        .eq("transcript_status", "transcribing");
      continue;
    }

    const longest = rec.finished.reduce((a, s) => (s.durationSec > a.durationSec ? s : a), rec.finished[0]);
    const { error: writeError } = await admin
      .from("interview_bookings")
      .update({
        transcript_segments: segments,
        recording_id: longest.id,
        transcript_job_id: segments[0].job_id,
        // A finished recording is evidence the interview happened.
        ...(b.status === "booked" ? { status: "completed" } : {}),
      })
      .eq("id", b.id)
      .eq("transcript_status", "transcribing");

    if (writeError) {
      // The DB refused the job ids; release rather than wedge. Worst case
      // the next run duplicates the jobs — pennies against a lost transcript.
      for (const s of segments) await deleteTranscriptJob(s.job_id);
      await admin
        .from("interview_bookings")
        .update({ transcript_status: null, transcript_claimed_at: null })
        .eq("id", b.id)
        .eq("transcript_status", "transcribing");
      continue;
    }
    stats.discovered++;
  }

  // ── collect ───────────────────────────────────────────────────────────────
  const { data: pending } = await admin
    .from("interview_bookings")
    .select("id, transcript_segments")
    .eq("transcript_status", "transcribing")
    .not("transcript_segments", "is", null)
    .order("starts_at", { ascending: true })
    .limit(10);

  for (const b of pending || []) {
    const segments = (b.transcript_segments as SegmentRecord[]) || [];
    if (segments.length === 0) continue;

    let anyError = false;
    let allFinished = true;
    for (const s of segments) {
      const job = await getTranscriptJob(s.job_id, b.id);
      if (!job) {
        allFinished = false; // vendor hiccup — retry next run
        break;
      }
      if (job.status === "error") {
        anyError = true;
        break;
      }
      if (job.status !== "finished") {
        allFinished = false;
        break;
      }
    }

    if (anyError) {
      await admin
        .from("interview_bookings")
        .update({ transcript_status: "error" })
        .eq("id", b.id)
        .eq("transcript_status", "transcribing");
      stats.errored++;
      continue;
    }
    if (!allFinished) continue;

    const parts: (ParsedTranscript & { seg: SegmentRecord })[] = [];
    let missing = false;
    for (const s of segments) {
      const parsed = await fetchTranscript(s.job_id, b.id);
      if (!parsed) {
        missing = true; // access-link/download hiccup — retry next run
        break;
      }
      parts.push({ ...parsed, seg: s });
    }
    if (missing) continue;

    const { error: writeError } = await admin
      .from("interview_bookings")
      .update({
        transcript: {
          source: "daily-batch-processor",
          duration_sec: parts.reduce((sum, p) => sum + (p.durationSec || 0), 0),
          text: parts.map((p) => p.text).filter(Boolean).join("\n\n"),
          // Chronological segments; each segment's timestamps restart at 0.
          segments: parts.map((p) => ({
            recording_id: p.seg.recording_id,
            job_id: p.seg.job_id,
            duration_sec: p.durationSec,
            text: p.text,
            utterances: p.utterances,
          })),
        },
        transcript_status: "done",
      })
      .eq("id", b.id)
      .eq("transcript_status", "transcribing");

    if (!writeError) {
      // Postgres now holds the transcript; Daily's copies are redundant.
      for (const s of segments) await deleteTranscriptJob(s.job_id);
      stats.transcribed++;
    }
  }

  // ── retire ────────────────────────────────────────────────────────────────
  // Recordings bill storage per minute until deleted. The retention window
  // leaves time for a flagged interview to be reviewed with video before the
  // mp4s go away; the transcript stays in Postgres forever.
  const cutoff = new Date(now - RETENTION_DAYS * 24 * 3600_000).toISOString();
  const { data: old } = await admin
    .from("interview_bookings")
    .select("id, recording_id, transcript_segments")
    .not("recording_id", "is", null)
    .is("recording_deleted_at", null)
    .in("transcript_status", ["done", "error"])
    .lt("starts_at", cutoff)
    .limit(8);

  for (const b of old || []) {
    const ids = Array.isArray(b.transcript_segments)
      ? (b.transcript_segments as SegmentRecord[]).map((s) => s.recording_id)
      : [b.recording_id as string];
    let allGone = true;
    for (const id of ids) {
      if (!(await deleteRecording(id, b.id))) allGone = false;
    }
    if (allGone) {
      await admin
        .from("interview_bookings")
        .update({ recording_deleted_at: new Date().toISOString() })
        .eq("id", b.id);
      stats.retired++;
    }
  }

  return NextResponse.json(stats);
}
