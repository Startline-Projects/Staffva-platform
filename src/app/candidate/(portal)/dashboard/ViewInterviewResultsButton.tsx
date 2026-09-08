"use client";

import { useState } from "react";

/**
 * The front door the interview results page never had.
 *
 * The results page (in the interview app) is good — five scored dimensions
 * with per-dimension feedback, strengths, areas to improve, and a path to a
 * perfect score. It was reachable ONLY by the redirect fired the instant an
 * interview ended, carrying a token that expires in 24 hours, linked from
 * nowhere. Close the tab and the feedback was gone: 52 candidates had
 * improvement advice written for them that they could no longer open.
 *
 * This mints a FRESH token on demand from the session the candidate is
 * already signed into — same mechanism as launching an interview — so the
 * results stay reachable for as long as the account exists, rather than for
 * a day.
 */
export default function ViewInterviewResultsButton({
  interviewId,
  label = "See your full interview feedback",
}: {
  interviewId: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function open() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/interview/token");
      if (!res.ok) {
        setError("We couldn't open your results right now. Try again in a minute, or contact support@staffva.com.");
        return;
      }
      const { token } = await res.json();
      const w = window.open(
        `https://interview.staffva.com/interview/results?id=${encodeURIComponent(interviewId)}&token=${encodeURIComponent(token)}`,
        "_blank",
        "noopener,noreferrer"
      );
      // A blocked pop-up returns null and the button silently does nothing.
      if (!w) setError("Your browser blocked the new tab. Allow pop-ups for staffva.com and try again.");
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="current-step-cta" onClick={open} disabled={busy}>
        <span>{busy ? "Opening…" : label}</span>
      </button>
      {error && <p style={{ marginTop: 10, fontSize: 13, color: "var(--danger)" }}>{error}</p>}
    </>
  );
}
