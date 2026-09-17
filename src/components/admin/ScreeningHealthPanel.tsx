"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ScreeningHealth } from "@/lib/adminScreening";

/**
 * Says what the screening tags are worth before anyone reads them as a queue.
 *
 * The Hold count has been shown as a number of flagged candidates on three
 * surfaces. It is mostly not that: it is the residue of screening that ran
 * against half-filled records, under a rubric written for a narrower business
 * than the one this platform became. Both are re-runnable, and until they are
 * re-run the number should not be presented as an opinion about anybody.
 */
export default function ScreeningHealthPanel({ health }: { health: ScreeningHealth }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<number | null>(null);

  const staleCount = health.stale.length;
  const holdShare = health.total > 0 ? Math.round((health.tags.Hold / health.total) * 100) : 0;
  const inFlight = health.queue.pending + health.queue.processing + health.queue.rate_limited;

  async function rescreen(scope: "stale" | "all" | "sample") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/screening/rescreen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Nothing was queued.");
        return;
      }
      setQueued(body.queued ?? 0);
      router.refresh();
    } catch {
      setError("The server could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rec-panel" style={{ marginBottom: 18 }}>
      <div className="rec-panel-label">What these tags are worth</div>

      {error && (
        <p className="rec-note-line" style={{ color: "var(--danger)", marginBottom: 10 }} role="alert">
          {error}
        </p>
      )}

      {queued !== null ? (
        <p className="rec-prose">
          <strong>{queued.toLocaleString()}</strong>{" "}
          {queued === 1 ? "candidate is" : "candidates are"} queued for re-screening. The cron works
          through 25 a minute and writes each new tag as it lands, so the numbers below will move
          for about {Math.max(1, Math.ceil(queued / 25))} minute{Math.ceil(queued / 25) === 1 ? "" : "s"}.
          Existing tags stay until a new one replaces them.
        </p>
      ) : (
        <>
          <p className="rec-prose" style={{ marginBottom: 12 }}>
            <strong>{health.tags.Hold.toLocaleString()} of {health.total.toLocaleString()} candidates
            ({holdShare}%) are tagged Hold.</strong>{" "}
            {staleCount > 0
              ? "Most of that is not a judgment about anybody — it is what these two things left behind."
              : "Every tag was computed from the candidate's completed profile under the current rubric."}
          </p>

          {staleCount > 0 && (
            <ul className="adm-causes">
              {health.staleBeforeProfile > 0 && (
                <li>
                  <strong>{health.staleBeforeProfile.toLocaleString()} were screened before the
                  candidate filled their profile in.</strong>
                  <div className="rec-note-line">
                    Screening used to run at the end of stage 1, against the values the form
                    invented — &ldquo;0-1 years&rdquo;, no bio, no skills. Those reasons still say
                    &ldquo;no bio, no listed skills&rdquo; for people who now have ten years of
                    experience. The enqueue point was fixed; the tags were never recomputed.
                  </div>
                </li>
              )}
              {health.staleOldRubric > 0 && (
                <li>
                  <strong>{health.staleOldRubric.toLocaleString()} were scored under the previous
                  rubric.</strong>
                  <div className="rec-note-line">
                    It asked whether each candidate suited &ldquo;a U.S. law firm or accounting
                    firm&rdquo; and held anyone whose role was unrelated to legal or accounting
                    work. This marketplace recruits across thirteen role families, so that held
                    four candidates in five for applying to a job it advertises.
                  </div>
                </li>
              )}
            </ul>
          )}

          {/* Three tags exist. If one has never once been applied, the rubric
              was not sorting the pool into three groups — say so, because the
              distribution alone reads as if the pool were uniformly weak. */}
          {health.tags.Priority === 0 && health.total > 0 && (
            <p className="rec-note-line" style={{ marginBottom: 10 }}>
              No candidate has ever been tagged Priority — not one, out of{" "}
              {health.total.toLocaleString()}.
            </p>
          )}

          {health.neverQueued > 0 && (
            <p className="rec-note-line" style={{ marginBottom: 10 }}>
              {health.neverQueued.toLocaleString()} candidate
              {health.neverQueued === 1 ? " has" : "s have"} never been queued for screening at all.
            </p>
          )}

          {inFlight > 0 && (
            <p className="rec-note-line" style={{ marginBottom: 10 }}>
              {inFlight.toLocaleString()} already waiting in the queue
              {health.queue.rate_limited > 0 && ` (${health.queue.rate_limited} backed off on rate limits)`}.
            </p>
          )}

          <div className="rec-actionbar">
            {staleCount > 0 && (
              <button type="button" className="adm-btn primary" disabled={busy} onClick={() => rescreen("sample")}>
                {busy ? "Queueing…" : "Try 20 first"}
              </button>
            )}
            {staleCount > 0 && (
              <button type="button" className="adm-btn" disabled={busy} onClick={() => rescreen("stale")}>
                {busy ? "Queueing…" : `Re-screen the ${staleCount.toLocaleString()} stale`}
              </button>
            )}
            <button type="button" className="adm-btn" disabled={busy} onClick={() => rescreen("all")}>
              {busy
                ? "Queueing…"
                : health.neverQueued > 0
                  ? `Re-screen all ${health.total.toLocaleString()}, including the ${health.neverQueued} never screened`
                  : `Re-screen all ${health.total.toLocaleString()}`}
            </button>
          </div>

          <p className="rec-note-line" style={{ marginTop: 10 }}>
            <strong>Try 20 first</strong> takes one candidate from each role family, so you can see
            whether the new rubric actually spreads the pool before it is applied to all of them —
            which is the check nobody ran on the rubric that produced this. Re-screening queues the
            work; the existing cron does it, 25 a minute, with its own rate limiting and retries.
            Nothing is cleared up front — a candidate keeps the tag they have until a new one
            replaces it.
          </p>
        </>
      )}
    </div>
  );
}
