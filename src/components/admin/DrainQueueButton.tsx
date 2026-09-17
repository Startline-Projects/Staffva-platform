"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DORMANT_AFTER_DAYS } from "@/lib/adminAlerts";
import type { SpecialistPerformance } from "@/lib/adminPerformance";

/**
 * Move one specialist's whole queue onto another.
 *
 * Reassigning sixty-three candidates one modal at a time is not a workflow
 * anybody completes, which is part of why these queues have sat where they are
 * since April. This is the same decision taken once.
 *
 * The destination list is every specialist, dormant ones included and labelled.
 * Hiding them would be the same mistake the picker on the candidate record used
 * to make — it filtered on `is_active`, which all eight absent specialists still
 * are, and so offered them as fixes with nothing to tell them apart.
 */
export default function DrainQueueButton({
  from,
  specialists,
}: {
  from: SpecialistPerformance;
  specialists: SpecialistPerformance[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [toId, setToId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ moved: number; warnings: string[] } | null>(null);

  const options = specialists
    .filter((s) => s.id !== from.id)
    .sort((a, b) => {
      const ad = isDormant(a), bd = isDormant(b);
      if (ad !== bd) return ad ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

  const to = options.find((s) => s.id === toId) ?? null;

  async function submit() {
    if (!toId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/reassign/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromRecruiterId: from.id, toRecruiterId: toId, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "The queue was not moved.");
        return;
      }
      setDone({ moved: body.moved ?? 0, warnings: body.warnings ?? [] });
      // The table above was rendered on the server and still shows the old
      // counts; nothing else on this page would correct them.
      router.refresh();
    } catch {
      setError("The server could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setError(null);
    setDone(null);
    setToId("");
    setReason("");
  }

  return (
    <>
      <button type="button" className="adm-btn sm" onClick={() => setOpen(true)}>
        Move queue
      </button>

      {open && (
        <div className="adm-modal-scrim" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="adm-modal" role="dialog" aria-modal="true" aria-label={`Move ${from.name}'s queue`}>
            <div className="adm-modal-head">
              <div className="adm-modal-title">
                {done ? "Queue moved" : `Move ${from.name}’s queue`}
              </div>
              <button type="button" className="adm-modal-close" onClick={close} aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>

            <div className="adm-modal-body">
              {done ? (
                <>
                  <p className="rec-prose">
                    <strong>{done.moved.toLocaleString()}</strong>{" "}
                    {done.moved === 1 ? "candidate is" : "candidates are"} now assigned to{" "}
                    <strong>{to?.name}</strong>. {from.name} was told once, not once per candidate.
                  </p>
                  {done.warnings.length > 0 && (
                    <p className="rec-note-line" style={{ color: "var(--danger)", marginTop: 10 }}>
                      The move itself went through, but {done.warnings.join(", and ")}.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="adm-modal-lead">
                    {from.assigned.toLocaleString()}{" "}
                    {from.assigned === 1 ? "candidate is" : "candidates are"} assigned to {from.name},
                    who last signed in{" "}
                    {from.daysSinceSignIn === null ? "never" : `${from.daysSinceSignIn} days ago`}.
                    Everyone in that queue moves at once.
                  </p>

                  <label className="adm-field-label" htmlFor="drain-to">Move them to</label>
                  <select
                    id="drain-to"
                    className="adm-select"
                    value={toId}
                    onChange={(e) => setToId(e.target.value)}
                    disabled={busy}
                  >
                    <option value="">— Choose a specialist —</option>
                    {options.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {" — "}
                        {s.daysSinceSignIn === null
                          ? "never signed in"
                          : s.daysSinceSignIn === 0
                            ? "signed in today"
                            : `last signed in ${s.daysSinceSignIn} days ago`}
                      </option>
                    ))}
                  </select>

                  {to && isDormant(to) && (
                    <p className="rec-note-line" style={{ color: "var(--danger)", marginTop: 8 }}>
                      {to.name} has not signed in for{" "}
                      {to.daysSinceSignIn === null ? "as long as this account has existed" : `${to.daysSinceSignIn} days`} either.
                      This would move the queue without anyone starting to work it, and the panel
                      would stop flagging it.
                    </p>
                  )}

                  <label className="adm-field-label" htmlFor="drain-reason" style={{ marginTop: 14 }}>
                    Reason <span style={{ textTransform: "none", letterSpacing: 0 }}>(recorded against every candidate)</span>
                  </label>
                  <textarea
                    id="drain-reason"
                    className="adm-input"
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Left the team — queue redistributed"
                    disabled={busy}
                  />

                  {error && (
                    <p className="rec-note-line" style={{ color: "var(--danger)", marginTop: 10 }} role="alert">
                      {error}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="adm-modal-foot">
              {done ? (
                <button type="button" className="adm-btn primary" onClick={close}>Done</button>
              ) : (
                <>
                  <button type="button" className="adm-btn" onClick={close} disabled={busy}>Cancel</button>
                  <button type="button" className="adm-btn primary" onClick={submit} disabled={!toId || busy}>
                    {busy ? "Moving…" : `Move ${from.assigned.toLocaleString()}`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function isDormant(s: SpecialistPerformance): boolean {
  return s.daysSinceSignIn === null || s.daysSinceSignIn >= DORMANT_AFTER_DAYS;
}
