"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  candidateId: string;
  verificationStatus: string;
  onComplete: () => void;
}

export default function IDVerification({
  candidateId,
  verificationStatus,
  onComplete,
}: Props) {
  const [loading, setLoading] = useState(false);

  // Already passed — auto-advance
  useEffect(() => {
    if (verificationStatus === "passed") {
      onComplete();
    }
  }, [verificationStatus, onComplete]);

  if (verificationStatus === "passed") {
    return null;
  }

  async function handleSkipForNow() {
    setLoading(true);

    // Auto-pass ID verification (dev/testing mode)
    // In production, this would go through Stripe Identity
    const supabase = createClient();
    await supabase
      .from("candidates")
      .update({ id_verification_status: "passed" })
      .eq("id", candidateId);

    onComplete();
  }

  // Manual review
  if (verificationStatus === "manual_review") {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
          <svg className="h-8 w-8 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-text">Under Manual Review</h1>
        <p className="mt-3 text-text/60">
          Your ID verification requires manual review by our team. We will
          notify you by email once this is resolved.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-2xl font-bold text-text">Identity Verification</h1>
      <p className="mt-2 text-sm text-text/60">
        Before building your profile, we need to verify your identity. This is
        required for all candidates and helps build trust with clients.
      </p>

      <div className="mt-8 rounded-xl border border-gray-200 bg-card p-6 space-y-4">
        <h2 className="font-semibold text-text">What you will need</h2>
        <ul className="space-y-2 text-sm text-text/80">
          <li className="flex gap-3">
            <svg className="h-5 w-5 shrink-0 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
            </svg>
            A government-issued photo ID (passport, driver&apos;s license, or national ID)
          </li>
          <li className="flex gap-3">
            <svg className="h-5 w-5 shrink-0 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
            </svg>
            A device with a camera for a selfie match
          </li>
        </ul>

        <div className="border-t border-gray-200 pt-4">
          <p className="text-xs text-text/40">
            Your ID is verified securely through Stripe Identity. StaffVA does
            not store your ID document — only the verification result.
          </p>
        </div>
      </div>

      {/* Dev mode: auto-pass button */}
      <div className="mt-6 space-y-3">
        <button
          onClick={handleSkipForNow}
          disabled={loading}
          className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {loading ? "Verifying..." : "Verify My Identity"}
        </button>
        <p className="text-center text-xs text-text/30">
          (Development mode — auto-passing verification)
        </p>
      </div>
    </div>
  );
}
