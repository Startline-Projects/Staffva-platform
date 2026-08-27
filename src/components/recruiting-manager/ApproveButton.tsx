"use client";

import { useState } from "react";

interface ApproveButtonProps {
  candidateId: string;
  aiInterviewCompleted: boolean;
  alreadyApproved: boolean;
}

export default function ApproveButton({
  candidateId,
  aiInterviewCompleted,
  alreadyApproved,
}: ApproveButtonProps) {
  const [loading, setLoading] = useState(false);
  const [approved, setApproved] = useState(alreadyApproved);
  const [error, setError] = useState<string | null>(null);

  const meetsRequirements = aiInterviewCompleted;

  const tooltipText = "Requires: AI interview must be passed first";

  async function handleApprove() {
    if (!meetsRequirements || loading || approved) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/recruiting-manager/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Approval failed");
      } else {
        setApproved(true);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (approved) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-green-100 px-4 py-2 text-sm font-semibold text-green-700">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
        Approved & Live
      </span>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="relative group">
        <button
          onClick={handleApprove}
          disabled={!meetsRequirements || loading}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            meetsRequirements
              ? "bg-green-600 text-white hover:bg-green-700"
              : "cursor-not-allowed bg-gray-200 text-gray-400"
          }`}
        >
          {loading ? (
            <>
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Approving...
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Approve Candidate
            </>
          )}
        </button>

        {/* Tooltip — only shown when requirements not met */}
        {!meetsRequirements && (
          <div className="pointer-events-none absolute bottom-full left-0 mb-2 hidden w-64 group-hover:block">
            <div className="rounded-lg bg-gray-900 px-3 py-2 text-xs text-white shadow-lg">
              {tooltipText}
              <div className="absolute left-3 top-full h-0 w-0 border-x-4 border-t-4 border-x-transparent border-t-gray-900" />
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
