"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Dashboard card: the session user's upcoming interviews, either side.
 * Renders nothing when there are none — a dashboard should not carry an
 * empty box for a feature the user isn't using right now.
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

export default function UpcomingInterviews() {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const res = await fetch("/api/interviews");
      if (!res.ok || cancelled) return;
      const data = await res.json();
      if (!cancelled && Array.isArray(data.interviews)) setRows(data.interviews);
    }
    run().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-text">Upcoming interviews</h3>
      <ul className="mt-3 divide-y divide-gray-100">
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
