"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Summary { activeLockouts: number; duplicatesThisWeek: number; flaggedForReview: number; totalVerifications: number }

export default function IdentitySummaryWidget() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/admin/identity");
        if (res.ok) { const d = await res.json(); setSummary(d.summary); }
      } catch { /* silent */ }
    }
    load();
  }, []);

  if (!summary) return null;

  const hasIssues = summary.activeLockouts > 0 || summary.flaggedForReview > 0;

  return (
    <Link href="/admin/identity" className="block rounded-2xl border border-border-light bg-card p-5 hover:border-text/20 transition-colors">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🔒</span>
        <h3 className="text-sm font-semibold text-text">Identity & Lockouts</h3>
        {hasIssues && <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />}
      </div>
      <div className="grid grid-cols-4 gap-3">
        <div className="text-center">
          <p className={`text-lg font-semibold ${summary.activeLockouts > 0 ? "text-red-600" : "text-text"}`}>{summary.activeLockouts}</p>
          <p className="text-[10px] text-text-tertiary">Lockouts</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-text">{summary.duplicatesThisWeek}</p>
          <p className="text-[10px] text-text-tertiary">Dupes/wk</p>
        </div>
        <div className="text-center">
          <p className={`text-lg font-semibold ${summary.flaggedForReview > 0 ? "text-primary" : "text-text"}`}>{summary.flaggedForReview}</p>
          <p className="text-[10px] text-text-tertiary">Flagged</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-text">{summary.totalVerifications}</p>
          <p className="text-[10px] text-text-tertiary">Verified</p>
        </div>
      </div>
    </Link>
  );
}
