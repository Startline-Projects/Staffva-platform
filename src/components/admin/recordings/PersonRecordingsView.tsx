"use client";

import { useState } from "react";
import Link from "next/link";
import {
  FOLDER_LABEL, FOLDER_ORDER, countWithRecordings,
  type AttemptFolder, type FolderKey, type SessionFootage,
} from "@/lib/recordingFolders";
import type { PersonRecordings } from "@/lib/adminRecordings";
import FootagePlayer from "./FootagePlayer";
import AnswerAudio from "./AnswerAudio";

/**
 * One person's recordings: assessment folders, and inside each an attempt
 * folder per sitting.
 *
 * Nothing under an attempt is fetched until it is opened. Opening one mints
 * signed URLs for webcam footage and writes an audit row, and neither should
 * happen because a page happened to render.
 */

const DAY_MS = 86_400_000;
/** The consent promise: flagged footage is kept until a decision and 7 days after. */
const KEPT_AFTER_DECISION_DAYS = 7;

const fmtDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "date unknown";
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—";
const mb = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

const ATTEMPT_STATUS: Record<string, string> = {
  completed: "Completed",
  graded: "Graded",
  in_progress: "Never finished",
  failed_technical: "Ended by a technical failure",
  submitted: "Submitted",
  expired: "Expired",
};

const CATEGORY: Record<string, string> = {
  second_person: "second person",
  substitution: "different person",
  absence: "candidate absent",
  device_use: "device in use",
  coaching: "being coached",
  no_footage: "camera showed nothing",
  footage_gap: "gaps in the footage",
  truncated: "footage cut short",
};

function review(f: SessionFootage): { text: string; tone: "bad" | "ok" | "warn" | "mute" } {
  switch (f.reviewStatus) {
    case "flagged": return { text: "Flagged — awaiting a decision", tone: "bad" };
    case "confirmed_cheating": return { text: `Confirmed${f.decidedBy ? ` by ${f.decidedBy}` : ""}`, tone: "bad" };
    case "cleared_by_human": return { text: `Cleared${f.decidedBy ? ` by ${f.decidedBy}` : ""}`, tone: "ok" };
    case "clear": return { text: "Reviewed clear", tone: "ok" };
    case "pending_review": return { text: "Waiting for automated review", tone: "warn" };
    case "recording": return { text: "Still recording", tone: "warn" };
    default: return { text: "No session record", tone: "mute" };
  }
}

const FolderIcon = ({ open = false }: { open?: boolean }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {open
      ? <path d="M3 8V6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7V10M3.6 19 2.2 11.6a1 1 0 0 1 1-1.2h17.6a1 1 0 0 1 1 1.2L20.4 19a1.5 1.5 0 0 1-1.5 1.2H5.1A1.5 1.5 0 0 1 3.6 19Z" />
      : <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z" />}
  </svg>
);

function Session({ f, index, of }: { f: SessionFootage; index: number; of: number }) {
  const [open, setOpen] = useState(false);
  const r = review(f);
  // Pure: derived from a stored timestamp, not from the clock.
  const deletedOnOrAfter = f.decidedAt
    ? new Date(Date.parse(f.decidedAt) + KEPT_AFTER_DECISION_DAYS * DAY_MS).toISOString()
    : null;

  return (
    <div className="rcd-session">
      <button type="button" className="rcd-session-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="rcd-caret" data-open={open} aria-hidden="true">›</span>
        <span className="rcd-session-title">
          Camera footage{of > 1 ? ` · part ${index} of ${of}` : ""}
          <span className="rec-note-line"> started {fmtTime(f.startedAt)} · {f.storedChunks} video slices · {f.storedFrames} frames · {mb(f.bytes)}</span>
        </span>
        <span className={`adm-pill ${r.tone}`}>{r.text}</span>
      </button>

      <div className="rcd-session-meta">
        {f.categories.length > 0 && (
          <span>Flagged for: {f.categories.map((c) => CATEGORY[c] ?? c.replace(/_/g, " ")).join(", ")}{f.confidence ? ` (${f.confidence} confidence)` : ""}.</span>
        )}
        {f.evidence && <span className="rcd-evidence">&ldquo;{f.evidence}&rdquo;</span>}
        {f.decisionNote && <span>Decision note: {f.decisionNote}</span>}
        {f.linkedBy === "start_time" && (
          <span>
            Filed here by start time. This session was never closed, so it carries no attempt link of its own —
            it began within minutes of this attempt and of no other.
          </span>
        )}
        {f.cameraLostCount > 0 && <span>The camera dropped out {f.cameraLostCount} time{f.cameraLostCount === 1 ? "" : "s"} during the session.</span>}
        {f.countedChunks !== f.storedChunks && f.reviewStatus !== "unknown" && (
          <span>The session record counts {f.countedChunks} slices; {f.storedChunks} are actually stored. What is listed here is what is stored.</span>
        )}
        {deletedOnOrAfter && <span>A decision was made {fmtDate(f.decidedAt)}, so this footage is deleted on or after {fmtDate(deletedOnOrAfter)}.</span>}
      </div>

      {open && <FootagePlayer sessionId={f.sessionId} />}
    </div>
  );
}

function Attempt({ a, folder, candidateId, startOpen }: { a: AttemptFolder; folder: FolderKey; candidateId: string; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const title = a.number ? `Attempt ${a.number} of ${a.of}` : "Attempt record missing";
  const outcome = a.passed === null || a.status !== "completed" ? null : a.passed ? "passed" : "did not pass";
  const undecided = a.footage.filter((f) => f.reviewStatus === "flagged" && !f.decidedAt).length;

  if (!a.hasRecordings) {
    // Listed so the numbering is whole, and so an absence is explained where
    // someone will look for it rather than discovered as a gap.
    const why = a.expired.some((e) => e.videoDeletedAt)
      ? `Footage deleted ${fmtDate(a.expired.find((e) => e.videoDeletedAt)!.videoDeletedAt)} — the automated review found nothing, and recordings are only kept when flagged.`
      : a.expired.length > 0
        ? "A camera session was opened and recorded nothing."
        : a.audio
          ? "Only empty recordings were stored — the recorder captured nothing."
          : "No recording was made.";
    return (
      <div className="rcd-attempt empty">
        <div className="rcd-attempt-head static">
          <span className="rcd-attempt-title">{title}</span>
          <span className="rec-note-line">{fmtDateTime(a.startedAt)}</span>
          <span className="rcd-attempt-why">{why}</span>
        </div>
      </div>
    );
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    // So the address bar can be pasted to a colleague and lands on this attempt.
    if (next) window.history.replaceState(null, "", `?open=${encodeURIComponent(a.key)}`);
  }

  return (
    <div className="rcd-attempt" id={`attempt-${a.key}`}>
      <button type="button" className="rcd-attempt-head" aria-expanded={open} onClick={toggle}>
        <span className="rcd-folder-icon"><FolderIcon open={open} /></span>
        <span className="rcd-attempt-title">{title}</span>
        <span className="rec-note-line">
          {fmtDateTime(a.startedAt)}
          {a.status ? ` · ${ATTEMPT_STATUS[a.status] ?? a.status.replace(/_/g, " ")}` : ""}
          {outcome ? ` · ${outcome}${a.score !== null ? ` (${a.score})` : ""}` : ""}
        </span>
        <span className="rcd-attempt-contents">
          {a.footage.length > 0 && <span>{a.footage.length} footage</span>}
          {a.audio && a.audio.files > a.audio.emptyFiles && <span>{a.audio.files - a.audio.emptyFiles} answers</span>}
          {undecided > 0 && <span className="adm-pill bad">{undecided} to decide</span>}
        </span>
      </button>

      {open && (
        <div className="rcd-attempt-body">
          {a.number === null && (
            <p className="rec-note-line" style={{ marginBottom: 10 }}>
              These answers were uploaded under an interview that no longer has a record, so this attempt cannot be
              dated or numbered. The path they were stored at is what places them in {FOLDER_LABEL[folder]}.
            </p>
          )}
          {a.footage.map((f, i) => <Session key={f.sessionId} f={f} index={i + 1} of={a.footage.length} />)}
          {a.audio && (
            <div className="rcd-session">
              <div className="rcd-session-head static">
                <span className="rcd-session-title">
                  Spoken answers
                  <span className="rec-note-line"> {a.audio.files} file{a.audio.files === 1 ? "" : "s"} · {mb(a.audio.bytes)}
                    {a.audio.emptyFiles > 0 ? ` · ${a.audio.emptyFiles} empty` : ""}</span>
                </span>
              </div>
              <AnswerAudio interviewId={a.audio.interviewId} candidateId={candidateId} />
            </div>
          )}
          {a.expired.filter((e) => e.videoDeletedAt).map((e) => (
            <p key={e.sessionId} className="rec-note-line" style={{ marginTop: 8 }}>
              One more camera session belonged to this attempt. It reviewed {e.reviewStatus.replace(/_/g, " ")} and its
              footage was deleted {fmtDate(e.videoDeletedAt)}.
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PersonRecordingsView({ data, initialOpen }: { data: PersonRecordings; initialOpen: string | null }) {
  const { person, filed } = data;
  const present = FOLDER_ORDER.filter((k) => filed.folders[k].length > 0);
  const absent = FOLDER_ORDER.filter((k) => filed.folders[k].length === 0);
  const nothing = present.length === 0 && filed.unsorted.length === 0;

  return (
    <div className="adm-col" style={{ maxWidth: 1000 }}>
      <Link href="/admin/video-reviews" className="rec-back">← All recordings</Link>

      <div className="adm-page-header">
        <div>
          <div className="adm-eyebrow">Recordings</div>
          <h1>{person.name}</h1>
          <div className="adm-subhead">
            {person.roleCategory ?? "No role on file"}
            {person.country && <><span className="sep">·</span>{person.country}</>}
            <span className="sep">·</span>{mb(filed.bytes)} stored
            {filed.awaitingDecision > 0 && (
              <><span className="sep">·</span><strong>{filed.awaitingDecision} flagged session{filed.awaitingDecision === 1 ? "" : "s"} awaiting a decision</strong></>
            )}
          </div>
        </div>
        <Link href={`/admin/candidates/${person.id}`} className="adm-btn">Candidate record</Link>
      </div>

      {nothing && (
        <div className="adm-state">
          <strong>Nothing is stored for {person.name}.</strong>
          <p style={{ marginTop: 8 }}>
            Camera footage is deleted as soon as the automated review finds nothing in it, and seven days after a
            person rules on a flagged session. If they sat an assessment and it is not here, that is why.
          </p>
        </div>
      )}

      <div className="rcd-tree">
        {present.map((key) => {
          const list = filed.folders[key];
          return (
            <section key={key} className="rcd-folder">
              <header className="rcd-folder-head">
                <span className="rcd-folder-icon big"><FolderIcon open /></span>
                <h2>{FOLDER_LABEL[key]}</h2>
                <span className="rec-note-line">
                  {list.length} attempt{list.length === 1 ? "" : "s"} · {countWithRecordings(list)} with recordings
                </span>
              </header>
              {list.map((a) => (
                <Attempt key={a.key} a={a} folder={key} candidateId={person.id} startOpen={initialOpen === a.key} />
              ))}
            </section>
          );
        })}

        {filed.unsorted.length > 0 && (
          <section className="rcd-folder">
            <header className="rcd-folder-head">
              <span className="rcd-folder-icon big"><FolderIcon open /></span>
              <h2>Unsorted</h2>
              <span className="rec-note-line">{filed.unsorted.length} session{filed.unsorted.length === 1 ? "" : "s"}</span>
            </header>
            <p className="rcd-folder-note">
              Interview footage that cannot be shown to belong to an attempt. A camera session is only tied to its
              interview when it ends cleanly, and no interview of {person.name}&apos;s began within ten minutes of
              {filed.unsorted.length === 1 ? " this one" : " these"} starting — so rather than guess between Interview 1
              and Interview 2, {filed.unsorted.length === 1 ? "it is" : "they are"} kept here. The start time is the
              way to place {filed.unsorted.length === 1 ? "it" : "them"} by hand.
            </p>
            <div className="rcd-attempt-body">
              {filed.unsorted.map((f) => (
                <div key={f.sessionId}>
                  <div className="rec-note-line" style={{ margin: "4px 0 6px" }}>{fmtDateTime(f.startedAt)}</div>
                  <Session f={f} index={1} of={1} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {!nothing && absent.length > 0 && (
        <p className="staff-legend" style={{ marginTop: 18 }}>
          No {absent.map((k) => FOLDER_LABEL[k]).join(" or ")} folder: nothing is stored for{" "}
          {absent.length === 1 ? "it" : "them"}. A folder exists only while it holds a recording — footage is deleted as
          soon as the automated review finds nothing in it, so an assessment that went cleanly leaves nothing behind.
        </p>
      )}
    </div>
  );
}
