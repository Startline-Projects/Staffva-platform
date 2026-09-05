"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
}: {
  engagementId: string;
  engagementStatus: string | null;
  contractStatus: string;
  noticeGivenAt: string | null;
  noticeGivenBy: string | null;
  endsAt: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Countdown only while the engagement is genuinely running: after the cron
  // completes it, "work and payment continue until then" would be a
  // present-tense promise on a closed engagement. Ended states are the page's
  // block copy's job.
  if (noticeGivenAt && engagementStatus === "active") {
    const ends = endsAt
      ? new Date(endsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" , timeZone: "UTC" })
      : "";
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">
          {noticeGivenBy === "candidate" ? "You gave" : "The client gave"} 14 days&apos; notice
        </p>
        <p className="mt-1 text-sm text-amber-800">
          This engagement ends on <strong>{ends}</strong>. Work and payment
          continue until then, and money already in escrow follows the normal
          release process.
        </p>
      </div>
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
  );
}
