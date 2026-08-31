"use client";

import { useEffect, useState } from "react";

/**
 * The client's interview prep, shown on the interview page before the call.
 * One fetch; the server generates on first view and caches on the booking,
 * so this is instant on every visit after the first.
 */

interface Brief {
  overview: string;
  verify: { claim: string; how: string }[];
  ask: { question: string; why: string }[];
  watch_for: string[];
  has_screening?: boolean;
}

export default function InterviewPrep({
  bookingId,
  candidateFirstName,
}: {
  bookingId: string;
  candidateFirstName: string;
}) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const res = await fetch(`/api/interviews/${bookingId}/brief`);
      if (cancelled) return;
      if (!res.ok) {
        setState("error");
        return;
      }
      const data = await res.json();
      setBrief(data.brief);
      setState("ready");
    }
    run().catch(() => {
      if (!cancelled) setState("error");
    });
    return () => {
      cancelled = true;
    };
  }, [bookingId, attempt]);

  if (state === "loading") {
    return (
      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-text">Interview prep</h2>
        <p className="mt-2 text-xs text-text-tertiary">
          Putting your brief together — about ten seconds, the first time only.
        </p>
      </div>
    );
  }

  if (state === "error" || !brief) {
    return (
      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-text">Interview prep</h2>
        <p className="mt-2 text-xs text-text-tertiary">
          Your brief isn&apos;t available right now.
        </p>
        <button
          onClick={() => {
            setState("loading");
            setAttempt((a) => a + 1);
          }}
          className="mt-3 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-text-secondary hover:border-gray-400"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-text">Interview prep</h2>
      <p className="mt-0.5 text-xs text-text-tertiary">
        Prepared from {candidateFirstName}&apos;s StaffVA{" "}
        {brief.has_screening === false ? "profile" : "screening and profile"}.
      </p>

      <p className="mt-4 text-sm leading-relaxed text-text">{brief.overview}</p>

      {brief.verify.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
            Worth verifying
          </h3>
          <ul className="mt-2 space-y-3">
            {brief.verify.map((v, i) => (
              <li key={i} className="text-sm">
                <p className="text-text">{v.claim}</p>
                <p className="mt-0.5 text-xs text-text-secondary">{v.how}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.ask.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
            Questions to ask
          </h3>
          <ol className="mt-2 space-y-3">
            {brief.ask.map((q, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="mt-0.5 shrink-0 text-xs font-semibold tabular-nums text-text-tertiary">
                  {i + 1}
                </span>
                <span>
                  <p className="font-medium text-text">{q.question}</p>
                  {q.why && <p className="mt-0.5 text-xs text-text-secondary">{q.why}</p>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {brief.watch_for.length > 0 && (
        <div className="mt-5 border-t border-gray-100 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
            Keep in mind
          </h3>
          <ul className="mt-2 space-y-1.5">
            {brief.watch_for.map((w, i) => (
              <li key={i} className="text-xs leading-relaxed text-text-secondary">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
