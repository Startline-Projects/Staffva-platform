"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PAUSE_AUTO_END_DAYS } from "@/lib/engagementLifecycle";

/**
 * The candidate's half of section 3: "Either party may terminate this
 * Agreement with 14 days' written notice delivered through the StaffVA
 * platform." Until step 20 the candidate had no exit at all — the clause
 * existed only for the party with a Release button.
 *
 * Renders one of three states: the countdown (notice already given, by
 * either side), the give-notice control (signed + active), or nothing
 * (the page's block copy already explains unsigned/ended states).
 */
export default function NoticeControl({
  engagementId,
  engagementStatus,
  contractStatus,
  noticeGivenAt,
  noticeGivenBy,
  endsAt,
  pausedAt = null,
  pausedBy = null,
}: {
  engagementId: string;
  engagementStatus: string | null;
  contractStatus: string;
  noticeGivenAt: string | null;
  noticeGivenBy: string | null;
  endsAt: string | null;
  pausedAt?: string | null;
  pausedBy?: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Countdown only while the engagement is genuinely running: after the cron
  // completes it, "work and payment continue until then" would be a
  // present-tense promise on a closed engagement. Ended states are the page's
  // block copy's job.
  async function pauseAction(action: "pause" | "resume") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/engagements/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engagementId, action }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || "We couldn't update the engagement. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // Paused state renders above everything: it changes what "active" means.
  const pauseBlock =
    engagementStatus === "active" && pausedAt ? (
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">
          {pausedBy === "candidate" ? "You paused this engagement" : "The client paused this engagement"}
        </p>
        <p className="mt-1 text-sm text-amber-800">
          No new payment periods accrue while paused.{" "}
          {noticeGivenAt ? (
            <>Notice is running — the engagement ends on its notice date.</>
          ) : (
            <>
              If it isn&apos;t resumed by{" "}
              <strong>
                {new Date(new Date(pausedAt).getTime() + PAUSE_AUTO_END_DAYS * 24 * 3600 * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}
              </strong>
              , it ends automatically. You can give 14 days&apos; notice at any
              time.
            </>
          )}
        </p>
        {pausedBy === "candidate" && (
          <button
            type="button"
            onClick={() => pauseAction("resume")}
            disabled={busy}
            className="mt-2 text-sm font-semibold text-amber-900 underline hover:no-underline disabled:opacity-50"
          >
            {busy ? "Resuming…" : "Resume the engagement"}
          </button>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    ) : null;

  if (noticeGivenAt && engagementStatus === "active") {
    const ends = endsAt
      ? new Date(endsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" , timeZone: "UTC" })
      : "";
    return (
      <>
      {pauseBlock}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">
          {noticeGivenBy === "candidate" ? "You gave" : "The client gave"} 14 days&apos; notice
        </p>
        <p className="mt-1 text-sm text-amber-800">
          This engagement ends on <strong>{ends}</strong>.{" "}
          {pausedAt
            ? "It's paused, so no new payment periods accrue before then — money already in escrow follows the normal release process."
            : "Work and payment continue until then, and money already in escrow follows the normal release process."}
        </p>
      </div>
      </>
    );
  }

  if (engagementStatus !== "active" || contractStatus !== "fully_executed") return null;

  async function giveNotice() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/engagements/notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engagementId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || "We couldn't record your notice. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    {pauseBlock}
    {!pausedAt && (
      <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-semibold text-[#1C1B1A]">Pausing this engagement</p>
        <p className="mt-1 text-sm text-gray-600">
          Either side can pause — no new payment periods accrue until the person
          who paused resumes it, and 30 days paused ends the engagement.
        </p>
        <button
          type="button"
          onClick={() => pauseAction("pause")}
          disabled={busy}
          className="mt-2 text-sm font-semibold text-[#1C1B1A] underline hover:no-underline disabled:opacity-50"
        >
          {busy ? "Pausing…" : "Pause"}
        </button>
      </div>
    )}
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="text-sm font-semibold text-[#1C1B1A]">Ending this engagement</p>
      <p className="mt-1 text-sm text-gray-600">
        {/* Quotes the clause it executes — the whole point of step 20 is that
            the product and the signed document say the same thing. */}
        Your agreement lets either side end it with 14 days&apos; written notice
        through StaffVA. Work and pay continue through the notice period, and
        notice can&apos;t be withdrawn once given.
      </p>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 text-sm font-semibold text-red-600 hover:text-red-800"
        >
          Give 14 days&apos; notice
        </button>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-sm text-gray-700">End this engagement in 14 days?</span>
          <button
            type="button"
            onClick={giveNotice}
            disabled={busy}
            className="rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "Recording…" : "Yes — give notice"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-xs font-medium text-gray-500 hover:text-gray-700"
          >
            Keep working
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
    </>
  );
}
