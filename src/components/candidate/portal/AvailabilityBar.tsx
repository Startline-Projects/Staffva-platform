"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The Atlas availability bar: the one-glance answer to "can clients find me
 * right now", with the pause toggle. Faithful to the prototype's two states —
 * available (animated green dot, "You're available · N hrs/wk · $X/hr",
 * button "Pause my profile") and paused (grey dot, "Profile paused · Hidden
 * from search", button "Set me to available").
 *
 * Pausing maps to availability_status = "not_available" — the value the
 * step-13 visibility system already treats as out of matching — via the same
 * endpoint the availability editor uses, so the 00186 stamp trigger records
 * it as a real candidate confirmation. Resume maps to "available_now".
 * A candidate on "available by <date>" who pauses and resumes comes back as
 * available NOW — the bar says so before they click.
 */
export default function AvailabilityBar({
  status,
  hourlyRate,
  hoursPerWeek,
  availabilityDate,
}: {
  status: string | null;
  hourlyRate: number | null;
  hoursPerWeek: number | null;
  availabilityDate: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paused = status === "not_available";
  const byDate = status === "available_by_date" && availabilityDate;

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/candidate/update-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability_status: paused ? "available_now" : "not_available" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "We couldn't update your availability. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const detail = [
    hoursPerWeek ? `${hoursPerWeek} hrs/wk` : null,
    hourlyRate ? `$${hourlyRate}/hr` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="live-availability" role="status" style={{ display: "flex" }}>
      <div className="live-avail-status">
        <span className={`live-avail-dot${paused ? " paused" : ""}`} aria-hidden="true"></span>
        <div className={`live-avail-text${paused ? " paused" : ""}`}>
          {paused ? (
            // NOT "hidden from search": not_available takes you out of job
            // MATCHING, and the reasons list below says so — but clients
            // browsing can still open your profile. The bar saying otherwise
            // while the card beneath it disagreed was the screen contradicting
            // itself.
            <>
              <strong>Profile <span className="status-word">paused</span></strong> · Out of new job matches
            </>
          ) : byDate ? (
            <>
              <strong>Available <span className="status-word">from {new Date(availabilityDate!).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span></strong>
              {detail ? <> · {detail}</> : null}
            </>
          ) : (
            <>
              <strong>You&apos;re <span className="status-word">available</span></strong>
              {detail ? <> · {detail}</> : null}
            </>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {error && <span style={{ fontSize: 12, color: "var(--danger)" }}>{error}</span>}
        <button type="button" className="live-avail-toggle" onClick={toggle} disabled={busy}>
          {busy ? "Saving…" : paused ? "Set me to available" : "Pause my profile"}
        </button>
      </div>
    </div>
  );
}
