"use client";

import { useState } from "react";

/** Mints an interview token and opens the interview app — same mechanics
 * as the legacy dashboard's launcher, in the Atlas step-card style. */
export default function StartInterviewButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function launch() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/interview/token");
      if (!res.ok) {
        setError("We couldn't start the interview right now. Try again in a minute, or contact support@staffva.com.");
        return;
      }
      const { token } = await res.json();
      window.open(`https://interview.staffva.com?token=${token}`, "_blank", "noopener,noreferrer");
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="current-step-cta" onClick={launch} disabled={busy}>
        <span>{busy ? "Opening…" : label}</span>
      </button>
      {error && <p style={{ marginTop: "10px", fontSize: "13px", color: "var(--danger)" }}>{error}</p>}
    </>
  );
}
