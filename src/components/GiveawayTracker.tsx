"use client";

import { useEffect, useState } from "react";

interface GiveawayEntry {
  application_complete: boolean;
  profile_approved: boolean;
  tag_verified: boolean;
  eligible: boolean;
}

export default function GiveawayTracker() {
  const [entry, setEntry] = useState<GiveawayEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/giveaway");
        if (res.ok) {
          const data = await res.json();
          setEntry(data.entry);
        }
      } catch { /* silent */ }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" />
          <span className="text-sm text-gray-500">Loading giveaway status...</span>
        </div>
      </div>
    );
  }

  if (!entry) return null;

  const steps = [
    { label: "Application submitted", complete: entry.application_complete },
    { label: "Profile approved and live", complete: entry.profile_approved },
    { label: "Tagged 3 friends in launch post", complete: entry.tag_verified },
  ];

  const completedCount = steps.filter((s) => s.complete).length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🎁</span>
        <h3 className="text-sm font-semibold text-[#1C1B1A]">$3,000 Launch Giveaway</h3>
        {entry.eligible && (
          <span className="ml-auto rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-semibold text-green-700">
            Eligible
          </span>
        )}
      </div>

      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-3">
            {step.complete ? (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100">
                <svg className="h-3.5 w-3.5 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
            ) : (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-gray-200">
                <span className="text-[10px] font-bold text-gray-400">{i + 1}</span>
              </div>
            )}
            <span className={`text-sm ${step.complete ? "text-[#1C1B1A] font-medium" : "text-gray-400"}`}>
              {step.label}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg bg-gray-50 p-3">
        {entry.eligible ? (
          <p className="text-xs text-green-700 font-medium">
            You are eligible for the $3,000 giveaway. Winners announced on the 1st of the month.
          </p>
        ) : (
          <p className="text-xs text-gray-500">
            Complete all 3 steps to be eligible for the $3,000 giveaway. {completedCount}/3 complete.
          </p>
        )}
      </div>
    </div>
  );
}
