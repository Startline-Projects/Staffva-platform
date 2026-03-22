"use client";

import type { CandidateData } from "@/app/(main)/apply/page";

interface Props {
  candidate: CandidateData;
  passed: boolean;
}

export default function TestResult({ candidate, passed }: Props) {
  if (candidate.permanently_blocked) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-text">Application Closed</h1>
        <p className="mt-3 text-text/60">
          You have used both attempts and are no longer eligible to retake the
          assessment. Thank you for your interest in StaffVA.
        </p>
      </div>
    );
  }

  if (!passed) {
    const retakeDate = candidate.retake_available_at
      ? new Date(candidate.retake_available_at).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : null;

    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-text">
          Assessment Not Passed
        </h1>
        <p className="mt-3 text-text/60">
          Unfortunately, your scores did not meet the minimum threshold of 70%
          on both sections.
        </p>
        <div className="mt-6 inline-flex gap-6 rounded-lg border border-gray-200 bg-card px-6 py-4">
          <div>
            <p className="text-xs text-text/40">Grammar</p>
            <p className="text-lg font-bold text-text">
              {candidate.english_mc_score ?? 0}%
            </p>
          </div>
          <div>
            <p className="text-xs text-text/40">Comprehension</p>
            <p className="text-lg font-bold text-text">
              {candidate.english_comprehension_score ?? 0}%
            </p>
          </div>
        </div>
        {retakeDate && candidate.retake_count < 2 && (
          <p className="mt-6 text-sm text-text/60">
            You may retake the assessment after{" "}
            <strong>{retakeDate}</strong>. One retake is allowed.
          </p>
        )}
      </div>
    );
  }

  return null;
}
