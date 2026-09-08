"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Dashboard card: the session user's upcoming interviews, either side.
 * Renders nothing when there are none — a dashboard should not carry an
 * empty box for a feature the user isn't using right now — unless the caller
 * passes `emptyState`. The client portal does: its rail deep-links to the
 * interviews section, and an anchor that resolves to nothing reads as a
 * broken nav item. When the caller supplies the section heading, it also
 * passes `headless` so the two don't stack.
 */

interface Row {
  id: string;
  startsAt: string;
  durationMinutes: number;
  counterpartName: string;
}

function fmtLocal(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function UpcomingInterviews({
  emptyState,
  headless,
}: {
  emptyState?: React.ReactNode;
  headless?: boolean;
} = {}) {
  const [rows, setRows] = useState<Row[]>([]);
  // An empty list is only honest once the request has actually answered:
  // "No interviews scheduled" over a 500 (or over a request still in flight)
  // is a false statement about the user's own data, not a silent omission.
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const res = await fetch("/api/interviews");
      if (cancelled) return;
      if (!res.ok) {
        setState("failed");
        return;
      }
      const data = await res.json();
      if (cancelled) return;
      if (Array.isArray(data.interviews)) setRows(data.interviews);
      setState("ready");
    }
    run().catch(() => {
      if (!cancelled) setState("failed");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "failed") {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
        We couldn&apos;t load your interviews just now. Refresh to try again.
      </p>
    );
  }

  if (rows.length === 0) return <>{state === "ready" ? emptyState ?? null : null}</>;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      {!headless && <h3 className="text-sm font-semibold text-text">Upcoming interviews</h3>}
      <ul className={`${headless ? "" : "mt-3 "}divide-y divide-gray-100`}>
        {rows.map((r) => (
          <li key={r.id}>
            <Link
              href={`/interviews/${r.id}`}
              className="flex items-center justify-between gap-3 py-2.5 hover:bg-gray-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-text">
                  {r.counterpartName}
                </span>
                <span className="block text-xs text-text-tertiary">
                  {fmtLocal(r.startsAt)} · {r.durationMinutes} min · video call
                </span>
              </span>
              <span className="shrink-0 text-xs font-medium text-text-secondary">View →</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
