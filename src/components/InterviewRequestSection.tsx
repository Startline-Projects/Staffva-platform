"use client";

import { useState } from "react";

interface Props {
  candidateId: string;
  candidateName: string;
  isLoggedIn: boolean;
  isClient: boolean;
}

export default function InterviewRequestSection({ candidateId, candidateName, isLoggedIn, isClient }: Props) {
  const [loading, setLoading] = useState<number | null>(null);
  const [error, setError] = useState("");

  if (!isLoggedIn || !isClient) return null;

  async function requestInterview(count: number) {
    setLoading(count);
    setError("");

    try {
      const res = await fetch("/api/interviews/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          interviewCount: count,
        }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setLoading(null);
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(null);
    }
  }

  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-6">
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
        <h3 className="text-sm font-semibold text-text">
          Have StaffVA interview {candidateName?.split(" ")[0]}
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Interview Once */}
        <div className="rounded-xl border border-purple-200 bg-white p-5">
          <div className="flex items-baseline justify-between mb-2">
            <h4 className="font-semibold text-text">Interview Once</h4>
            <p className="text-2xl font-bold text-purple-700">$50</p>
          </div>
          <p className="text-xs text-text/60 mb-4">
            One 20-minute structured interview. Notes and scores added to profile. Emailed to you.
          </p>
          <button
            onClick={() => requestInterview(1)}
            disabled={loading !== null}
            className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 transition-colors disabled:opacity-50"
          >
            {loading === 1 ? "Redirecting to checkout..." : "Request Interview"}
          </button>
        </div>

        {/* Interview Twice */}
        <div className="rounded-xl border-2 border-purple-400 bg-white p-5 relative">
          <span className="absolute -top-2.5 right-4 rounded-full bg-purple-600 px-2.5 py-0.5 text-[10px] font-semibold text-white uppercase">
            Best Value
          </span>
          <div className="flex items-baseline justify-between mb-2">
            <h4 className="font-semibold text-text">Interview Twice</h4>
            <p className="text-2xl font-bold text-purple-700">$90</p>
          </div>
          <p className="text-xs text-text/60 mb-4">
            Two separate interviews for deeper evaluation. Both sets of notes and scores added to profile. Both emailed to you.
          </p>
          <button
            onClick={() => requestInterview(2)}
            disabled={loading !== null}
            className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 transition-colors disabled:opacity-50"
          >
            {loading === 2 ? "Redirecting to checkout..." : "Request Interview"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-600 text-center">{error}</p>
      )}

      <p className="mt-4 text-[10px] text-text/40 text-center">
        Interviews are conducted by StaffVA team members within 48 hours. Notes are permanent and visible to all future clients.
      </p>
    </div>
  );
}
