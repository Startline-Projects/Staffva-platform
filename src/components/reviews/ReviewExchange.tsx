"use client";

import { useState } from "react";
import {
  REVIEW_BLOCK_COPY,
  blockReasonFor,
  daysUntilReveal,
  type ReviewState,
} from "@/lib/reviewEligibility";

/**
 * One engagement's review exchange, rendered identically for both sides.
 *
 * The client and the candidate get the same component on purpose. A review
 * system where one side is asked warmly and the other is asked in a footnote
 * is not two-sided in any way that matters, and the two screens drifting apart
 * is how that happens. Everything shown here comes from my_review_state(), so
 * neither side can be told something the database would contradict.
 */
export default function ReviewExchange({
  state,
  onChange,
}: {
  state: ReviewState;
  onChange: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reason = blockReasonFor(state);
  const days = daysUntilReveal(state);
  const subject = state.counterparty;

  async function submit() {
    if (busy || rating === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId: state.engagement_id,
          rating,
          body: body.trim() || null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || "We couldn't save your review.");
        return;
      }
      onChange();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reviews", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engagementId: state.engagement_id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || "We couldn't withdraw your review.");
        return;
      }
      onChange();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // ── Nothing to do yet ──────────────────────────────────────────────────────
  if (reason === "no_released_payment") {
    const copy = REVIEW_BLOCK_COPY.no_released_payment;
    return (
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
        <p className="text-sm font-medium text-text">{copy.title}</p>
        <p className="mt-1 text-xs text-text/60">{copy.detail}</p>
      </div>
    );
  }

  // ── Submitted, waiting on the other side ───────────────────────────────────
  if (reason === "already_submitted") {
    const copy = REVIEW_BLOCK_COPY.already_submitted;
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-amber-900">{copy.title}</p>
            <p className="mt-1 text-xs text-amber-800">{copy.detail}</p>
            {days !== null && (
              <p className="mt-1 text-xs text-amber-700">
                {days === 0
                  ? "The deadline has passed — it reveals any moment now."
                  : `Reveals in ${days} day${days === 1 ? "" : "s"} if they don't submit first.`}
              </p>
            )}
          </div>
          <button
            onClick={withdraw}
            disabled={busy}
            className="shrink-0 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            {busy ? "Withdrawing…" : "Withdraw"}
          </button>
        </div>
        {/* Their own words back to them. The RLS policy on reviews admits
            revealed rows only, so this is the one place an author can re-read
            what they wrote while it is still sealed. */}
        <Stars value={state.your_rating ?? 0} className="mt-3" />
        {state.your_body && (
          <p className="mt-1 text-xs italic text-amber-900/80">&ldquo;{state.your_body}&rdquo;</p>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  // ── The window closed without them ─────────────────────────────────────────
  // Reachable two ways: they never wrote one, or this person never did. Both
  // are settled states with nothing to do, so they share a card.
  if (reason === "window_closed" || reason === "no_reply" || reason === "exchange_complete") {
    const copy = REVIEW_BLOCK_COPY[reason];
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-text">{copy.title}</p>
        <p className="mt-1 text-xs text-text/60">{copy.detail}</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-text/40">You wrote</p>
            {state.you_submitted ? (
              <>
                <Stars value={state.your_rating ?? 0} className="mt-1" />
                {state.your_body && (
                  <p className="mt-1 text-xs text-text/70">{state.your_body}</p>
                )}
              </>
            ) : (
              <p className="mt-1 text-xs text-text/50">Nothing — the window closed first.</p>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-text/40">{subject} wrote</p>
            {/* Three distinct outcomes, said as three distinct things. An
                earlier version printed "Nothing was submitted" for all of them,
                which was a false account of the staff-takedown case — the same
                defect this step exists to remove, reintroduced by the fix for
                it. their_withheld (migration 00200) is what tells them apart. */}
            {state.their_withheld ? (
              <p className="mt-1 text-xs text-text/50">
                They wrote one, and our team removed it.
              </p>
            ) : !state.their_visible ? (
              <p className="mt-1 text-xs text-text/50">
                Nothing — the deadline passed without a review from them.
              </p>
            ) : (
              <>
                <Stars value={state.their_rating ?? 0} className="mt-1" />
                {state.their_body && (
                  <p className="mt-1 text-xs text-text/70">{state.their_body}</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Open: write one ────────────────────────────────────────────────────────
  return (
    <div className="rounded-lg border border-[#FE6E3E]/40 bg-orange-50 p-4">
      <p className="text-sm font-medium text-text">
        {state.your_role === "client"
          ? `How did working with ${subject} go?`
          : `How was working with ${subject}?`}
      </p>
      <p className="mt-1 text-xs text-text/60">
        Neither review is visible until you&apos;ve both submitted, or 30 days pass.
      </p>

      <div
        className="mt-3 flex gap-1"
        onMouseLeave={() => setHovered(0)}
        role="radiogroup"
        aria-label="Rating out of five"
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onMouseEnter={() => setHovered(n)}
            onClick={() => setRating(n)}
            className="text-2xl leading-none transition-transform hover:scale-110"
          >
            <span className={n <= (hovered || rating) ? "text-amber-400" : "text-gray-300"}>
              ★
            </span>
          </button>
        ))}
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="What should the next person know? (optional)"
        className="mt-3 w-full rounded-lg border border-gray-200 p-2 text-sm focus:border-[#FE6E3E] focus:outline-none"
      />

      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={busy || rating === 0}
          className="rounded-full bg-[#FE6E3E] px-5 py-2 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors disabled:opacity-40"
        >
          {busy ? "Submitting…" : "Submit review"}
        </button>
        {rating === 0 && <span className="text-xs text-text/50">Pick a rating to submit.</span>}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function Stars({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`flex gap-0.5 ${className}`} aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= value ? "text-amber-400" : "text-gray-300"} aria-hidden>
          ★
        </span>
      ))}
    </div>
  );
}
