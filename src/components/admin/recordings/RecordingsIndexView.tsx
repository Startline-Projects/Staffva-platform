"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FOLDER_LABEL, FOLDER_ORDER } from "@/lib/recordingFolders";
import type { PersonCard } from "@/lib/adminRecordings";

/** Everyone with a recording in storage, one folder each. */

const mb = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function RecordingsIndexView({ people }: { people: PersonCard[] }) {
  const [q, setQ] = useState("");
  const [onlyUndecided, setOnlyUndecided] = useState(false);

  const undecidedPeople = people.filter((p) => p.awaitingDecision > 0).length;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter((p) =>
      (!onlyUndecided || p.awaitingDecision > 0) &&
      (!needle || p.name.toLowerCase().includes(needle) || (p.roleCategory ?? "").toLowerCase().includes(needle))
    );
  }, [people, q, onlyUndecided]);

  if (people.length === 0) {
    return (
      <div className="adm-state">
        <strong>No recordings are stored right now.</strong>
        <p style={{ marginTop: 8 }}>
          That is the normal state, not a fault. Camera footage is deleted the moment the automated review finds
          nothing in it, and seven days after a person rules on a flagged session — so a folder only appears here
          while there is something in it that someone may need to watch.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rcd-toolbar">
        <input
          className="adm-input" style={{ maxWidth: 320 }} type="search" value={q}
          onChange={(e) => setQ(e.target.value)} placeholder="Find a person or a role…" aria-label="Filter people"
        />
        {undecidedPeople > 0 && (
          <button type="button" className={`alerts-filter${onlyUndecided ? " active" : ""}`} onClick={() => setOnlyUndecided(!onlyUndecided)}>
            <span className="filter-dot" style={{ background: "var(--danger)" }} />
            Awaiting a decision
            <span className="filter-count">{undecidedPeople}</span>
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="rec-note-line" style={{ marginTop: 16 }}>Nobody matches that. {people.length} {people.length === 1 ? "person has" : "people have"} recordings.</p>
      ) : (
        <div className="rcd-grid">
          {shown.map((p) => (
            <Link key={p.candidateId} href={`/admin/video-reviews/${p.candidateId}`} className="rcd-person">
              <div className="rcd-person-top">
                <span className="rcd-person-avatar">
                  {p.photoUrl
                    /* eslint-disable-next-line @next/next/no-img-element */
                    ? <img src={p.photoUrl} alt="" />
                    : initials(p.name)}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="rcd-person-name">{p.name}</span>
                  <span className="rcd-person-role">{p.roleCategory ?? "No role on file"}</span>
                </span>
              </div>

              <ul className="rcd-person-folders">
                {FOLDER_ORDER.filter((k) => p.counts[k] > 0).map((k) => (
                  <li key={k}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z" /></svg>
                    {FOLDER_LABEL[k]}
                    <span className="n">{p.counts[k]} attempt{p.counts[k] === 1 ? "" : "s"}</span>
                  </li>
                ))}
                {p.unsorted > 0 && (
                  <li>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z" /></svg>
                    Unsorted
                    <span className="n">{p.unsorted} session{p.unsorted === 1 ? "" : "s"}</span>
                  </li>
                )}
              </ul>

              <div className="rcd-person-foot">
                <span>{mb(p.bytes)} · latest {fmtDate(p.newest)}</span>
                {p.awaitingDecision > 0 && <span className="adm-pill bad">{p.awaitingDecision} to decide</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
