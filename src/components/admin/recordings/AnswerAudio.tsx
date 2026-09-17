"use client";

import { useEffect, useState } from "react";

/**
 * The spoken answers from one Interview 1 attempt, in the order they were
 * recorded. Fetched when the attempt is opened — see the route for why.
 */

interface AudioFile { name: string; label: string; size: number; recordedAt: string | null; url: string | null }

const kb = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);
const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";

export default function AnswerAudio({ interviewId, candidateId }: { interviewId: string; candidateId: string }) {
  const [files, setFiles] = useState<AudioFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/recordings/interview-audio/${interviewId}?candidate=${candidateId}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) { setError(body.error ?? `The answers could not be opened (${r.status}).`); return; }
        setFiles(body.files ?? []);
      })
      .catch(() => { if (alive) setError("The server could not be reached."); });
    return () => { alive = false; };
  }, [interviewId, candidateId]);

  if (error) return <p className="rec-note-line" style={{ color: "var(--danger)" }} role="alert">{error}</p>;
  if (!files) return <div className="adm-skeleton" style={{ height: 56 }} />;
  if (files.length === 0) return <p className="rec-note-line">No answer recordings are stored for this attempt.</p>;

  return (
    <ul className="rcd-audio">
      {files.map((f) => (
        <li key={f.name}>
          <div className="rcd-audio-head">
            <span className="rcd-audio-label">{f.label}</span>
            <span className="rec-note-line">{f.url ? kb(f.size) : "0 bytes"}{f.recordedAt ? ` · ${time(f.recordedAt)}` : ""}</span>
          </div>
          {f.url ? (
            <audio controls preload="none" src={f.url} />
          ) : (
            // No player: one that loads and sits silent reads as "they said
            // nothing", when what happened is that nothing was captured.
            <p className="rec-note-line" style={{ color: "var(--danger)" }}>
              Empty file — the recorder captured nothing for this question.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
