"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The three candidate-side outcome actions the step-18 audit found promised
 * but unreachable. Every API here already existed and was fully guarded —
 * nothing on any screen called them:
 *
 *  - RESUBMIT: the revision card said "then resubmit" while only staff could
 *    flip revision_required back to review. The candidate stayed
 *    revision_required forever.
 *  - APPEAL: /api/candidate/appeal (one per rejection) had no form anywhere;
 *    the rejected state offered only mailto:support.
 *  - REAPPLY: the 6-month hold self-expires in the DB, and on day one past
 *    the date the candidate still stared at "This application is closed"
 *    with no door. /api/candidate/reapply was called from nowhere.
 */

function useAction(path: string, body?: Record<string, unknown>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function run(extra?: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(body ?? {}), ...(extra ?? {}) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || "Something went wrong. Try again.");
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, done };
}

/** "I've made the changes — send it back" on the revision card. */
export function ResubmitButton() {
  const { run, busy, error, done } = useAction("/api/candidate/resubmit");
  if (done) {
    return (
      <p style={{ marginTop: 12, fontSize: 14, color: "var(--success, #2E7D54)" }}>
        Sent back for review. Your reviewer will see the updated application.
      </p>
    );
  }
  return (
    <div style={{ marginTop: 12 }}>
      <button type="button" className="current-step-cta" onClick={() => run()} disabled={busy}>
        <span>{busy ? "Sending…" : "I've made the changes — resubmit for review"}</span>
      </button>
      {error && <p style={{ marginTop: 8, fontSize: 13, color: "var(--danger, #C2412B)" }}>{error}</p>}
    </div>
  );
}

/** The appeal form on the rejected state — one per rejection, by the API's rule. */
export function AppealForm() {
  const [text, setText] = useState("");
  const { run, busy, error, done } = useAction("/api/candidate/appeal");
  if (done) {
    return (
      <p style={{ marginTop: 12, fontSize: 14 }}>
        Your appeal is in. The decision and response will appear here when a
        person has looked at it.
      </p>
    );
  }
  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
        Think we got this wrong?
      </p>
      <p style={{ fontSize: 13, color: "var(--ink-mute, #6B6860)", marginBottom: 8 }}>
        Tell us what you think the review missed. One appeal per decision, and a
        person reads it — this is not automated.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        maxLength={2000}
        placeholder="What did the review miss?"
        style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--line, #D9D2C3)", fontSize: 14 }}
      />
      <button
        type="button"
        className="current-step-cta"
        style={{ marginTop: 8 }}
        onClick={() => run({ text })}
        disabled={busy || text.trim().length < 20}
      >
        <span>{busy ? "Submitting…" : "Submit appeal"}</span>
      </button>
      {text.trim().length > 0 && text.trim().length < 20 && (
        <p style={{ marginTop: 6, fontSize: 12, color: "var(--ink-mute, #6B6860)" }}>
          A few more words — at least 20 characters.
        </p>
      )}
      {error && <p style={{ marginTop: 8, fontSize: 13, color: "var(--danger, #C2412B)" }}>{error}</p>}
    </div>
  );
}

/** The door the self-expiring hold never had. */
export function ReapplyButton() {
  const { run, busy, error, done } = useAction("/api/candidate/reapply");
  if (done) {
    return (
      <p style={{ marginTop: 12, fontSize: 14, color: "var(--success, #2E7D54)" }}>
        Welcome back. Your application is open again — your assessments and
        interviews are still on file.
      </p>
    );
  }
  return (
    <div style={{ marginTop: 12 }}>
      <button type="button" className="current-step-cta" onClick={() => run()} disabled={busy}>
        <span>{busy ? "Reopening…" : "Apply again"}</span>
      </button>
      {error && <p style={{ marginTop: 8, fontSize: 13, color: "var(--danger, #C2412B)" }}>{error}</p>}
    </div>
  );
}
