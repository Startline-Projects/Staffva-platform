"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TRANSCRIPT_PLANS, type TranscriptTurn } from "@/lib/transcriptAccess";

interface Interview {
  completed_at: string | null;
  transcript: TranscriptTurn[] | null;
}

/**
 * The candidate's screening interview, in full, for clients who subscribe.
 *
 * WHAT IS BEHIND THE PAYWALL, and what deliberately is not. The scorecard
 * above this component — the five category scores WITH their feedback, plus
 * strengths and areas for improvement — has always been free to any signed-in
 * client, and it stays free. Moving it behind the wall would be taking
 * something away from clients who have it today, which is a pricing decision
 * for the owner and not a side effect of building this.
 *
 * So what is sold is the thing that genuinely was not available before: the
 * transcript itself — what was actually asked, and what the candidate actually
 * said.
 *
 * The body arrives from the server already gated. There is no transcript in
 * the payload when the client has not paid, because a paywall implemented as a
 * blur filter over data that was already sent is not a paywall.
 */
export default function InterviewTranscript({ candidateId }: { candidateId: string }) {
  const [state, setState] = useState<"loading" | "locked" | "none" | "ready" | "error">("loading");
  const [interview, setInterview] = useState<Interview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/client/transcripts/${candidateId}`)
      .then(async (r) => {
        if (!alive) return;
        if (r.status === 402) return setState("locked");
        if (!r.ok) return setState("error");
        const j = await r.json();
        if (!j.interview) return setState("none");
        setInterview(j.interview);
        setState(j.interview.transcript?.length ? "ready" : "none");
      })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, [candidateId]);

  async function subscribe(interval: "month" | "year") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/client/transcripts/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.url) {
        setError(j.error || "We couldn't start checkout.");
        return;
      }
      window.location.href = j.url;
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading" || state === "error") {
    // A failed read renders nothing rather than an upsell. Showing "subscribe
    // to unlock" when we simply could not reach the database would be selling
    // access to something we have not established exists.
    return null;
  }

  if (state === "none") {
    return (
      <section className="tx" id="transcript">
        <h2 className="tx-title">Interview transcript</h2>
        <p className="tx-empty">
          This candidate hasn&apos;t sat a recorded screening interview, so there&apos;s no
          transcript to read. Most haven&apos;t yet.
        </p>
      </section>
    );
  }

  if (state === "locked") {
    return (
      <section className="tx" id="transcript">
        <h2 className="tx-title">Interview transcript</h2>
        <p className="tx-lead">
          Read the full screening interview — every question, and what the candidate actually said.
          One subscription covers every candidate on StaffVA.
        </p>
        <div className="tx-plans">
          <button className="btn btn-primary" onClick={() => subscribe("month")} disabled={busy}>
            {busy ? "Starting…" : `${TRANSCRIPT_PLANS.month.blurb}`}
          </button>
          <button className="btn btn-outline" onClick={() => subscribe("year")} disabled={busy}>
            {TRANSCRIPT_PLANS.year.blurb}
          </button>
        </div>
        <p className="tx-note">
          {/* Said plainly, because it is the honest objection to buying. */}
          Around one candidate in five has sat a recorded interview so far. The scores and feedback
          above are free and always will be — this adds the transcript behind them. Cancel any time
          from <Link href="/billing">Billing</Link>.
        </p>
        {error && <p className="tx-error">{error}</p>}
      </section>
    );
  }

  const turns = interview?.transcript ?? [];
  return (
    <section className="tx" id="transcript">
      <h2 className="tx-title">Interview transcript</h2>
      <p className="tx-lead">
        StaffVA&apos;s screening interview
        {interview?.completed_at
          ? `, ${new Date(interview.completed_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
          : ""}
        . {turns.length} exchanges, unedited.
      </p>
      <ol className="tx-turns">
        {turns.map((t, i) => (
          <li key={i} className={t.speaker === "interviewer" ? "tx-q" : "tx-a"}>
            <span className="tx-who">{t.speaker === "interviewer" ? "Interviewer" : "Candidate"}</span>
            <p>{t.text}</p>
          </li>
        ))}
      </ol>
      <p className="tx-note">
        Transcribed automatically from the spoken interview, so expect the odd mis-heard word. It
        is not edited or corrected by StaffVA.
      </p>
    </section>
  );
}
