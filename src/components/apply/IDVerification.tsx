"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

interface Props {
  candidateId: string;
  verificationStatus: string;
  onComplete: () => void;
}

export default function IDVerification({ candidateId, verificationStatus, onComplete }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [polling, setPolling] = useState(false);
  const [stillProcessing, setStillProcessing] = useState(false);

  // Auto-advance if already passed
  useEffect(() => {
    if (verificationStatus === "passed") {
      onComplete();
    }
  }, [verificationStatus, onComplete]);

  // On mount: check if returning from Stripe (URL has ?id_check=returning)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("id_check") === "returning") {
      // Returning from Stripe — poll for status update
      setPolling(true);
      pollForVerification();
      // Clean the URL
      window.history.replaceState({}, "", "/apply");
    }
  }, []);

  const pollForVerification = useCallback(async () => {
    const supabase = createClient();
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max

    const interval = setInterval(async () => {
      attempts++;
      try {
        const { data } = await supabase
          .from("candidates")
          .select("id_verification_status")
          .eq("id", candidateId)
          .single();

        if (data?.id_verification_status === "passed") {
          clearInterval(interval);
          setPolling(false);
          onComplete();
          return;
        }

        if (data?.id_verification_status === "failed") {
          clearInterval(interval);
          setPolling(false);
          setError("Verification could not be completed. Please try again or contact support.");
          return;
        }

        // After 15 seconds of polling with no webhook, try checking Stripe directly
        if (attempts === 15) {
          try {
            const checkRes = await fetch("/api/identity/check-status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ candidateId }),
            });
            const checkData = await checkRes.json();
            if (checkData.status === "passed") {
              clearInterval(interval);
              setPolling(false);
              onComplete();
              return;
            }
          } catch { /* continue polling */ }
        }

        if (attempts >= maxAttempts) {
          clearInterval(interval);
          setPolling(false);
          // This used to auto-pass: after 30 seconds without a webhook the
          // CLIENT wrote id_verification_status='passed' itself, so a slow
          // Stripe response — or anyone with the anon key — could mint a
          // verified identity. Now the browser cannot write that column at all
          // (migration 00120); only the Stripe webhook and the server's own
          // Stripe lookup can. Ask the server one final time, then show the
          // still-processing state rather than inventing a result.
          try {
            const checkRes = await fetch("/api/identity/check-status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ candidateId }),
            });
            const checkData = await checkRes.json();
            if (checkData.status === "passed") {
              onComplete();
              return;
            }
          } catch { /* fall through to the still-processing state */ }
          setStillProcessing(true);
        }
      } catch {
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          setPolling(false);
          setStillProcessing(true);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [candidateId, onComplete]);

  if (verificationStatus === "passed") return null;

  // Polling state — returning from Stripe
  if (polling) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
        <h1 className="text-2xl font-semibold text-text">Verifying your identity...</h1>
        <p className="mt-3 text-text-muted">
          This usually takes a few seconds. Please don&apos;t close this page.
        </p>
      </div>
    );
  }

  // Verification genuinely still processing at Stripe after 30s of polling.
  // The old behaviour here was to pass the candidate; now we tell the truth.
  if (stillProcessing) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
          <svg className="h-8 w-8 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-text">Still verifying your identity</h1>
        <p className="mt-3 text-text-muted">
          Verification is taking longer than usual. This can happen when the photo needs a closer look. You can check again in a moment — your progress is saved.
        </p>
        <button
          onClick={() => {
            setStillProcessing(false);
            setPolling(true);
            pollForVerification();
          }}
          className="mt-6 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
        >
          Check again
        </button>
      </div>
    );
  }

  // Failed state
  if (verificationStatus === "failed") {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-text">Verification could not be completed</h1>
        <p className="mt-3 text-text-muted">
          This may be due to an unclear photo or unsupported document. Please try again or contact <a href="mailto:support@staffva.com" className="text-primary underline">support@staffva.com</a>.
        </p>
        <button
          onClick={handleVerify}
          disabled={loading}
          className="mt-6 text-sm text-primary hover:underline"
        >
          {loading ? "Starting..." : "Try again"}
        </button>
      </div>
    );
  }

  // Manual review state
  if (verificationStatus === "manual_review") {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
          <svg className="h-8 w-8 text-amber-600 animate-pulse" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-text">Under review</h1>
        <p className="mt-3 text-text-muted">
          Your verification is being reviewed. This typically takes up to 48 hours. We&apos;ll email you when it&apos;s resolved.
        </p>
        <Link href="/candidate/dashboard" className="mt-6 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors">
          View dashboard
        </Link>
      </div>
    );
  }

  // Default — pending, show verify button
  async function handleVerify() {
    setLoading(true);
    setError("");

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setError("Please sign in to continue.");
        setLoading(false);
        return;
      }

      const res = await fetch("/api/identity/create-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ candidateId }),
      });

      const data = await res.json();

      if (data.alreadyVerified) {
        onComplete();
        return;
      }

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      if (data.error) {
        // This used to detect "Stripe not configured" and PASS the candidate —
        // identity verification waved through precisely when the verifier was
        // down. A vendor outage is a reason to stop, not a reason to approve.
        setError("Identity verification is temporarily unavailable. Please try again in a few minutes.");
      } else {
        setError("Something went wrong starting verification. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    }

    setLoading(false);
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-text">Identity Verification</h1>
      <p className="mt-2 text-sm text-text-muted">
        We verify every professional&apos;s identity. This takes about 60 seconds.
      </p>

      <div className="mt-8 rounded-2xl border border-border-light bg-card p-6 space-y-4">
        <h2 className="font-semibold text-text">What you&apos;ll need</h2>
        <ul className="space-y-2 text-sm text-text-muted">
          <li className="flex gap-3">
            <svg className="h-5 w-5 shrink-0 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
            </svg>
            A government-issued photo ID
          </li>
          <li className="flex gap-3">
            <svg className="h-5 w-5 shrink-0 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
            </svg>
            A device with a camera for a selfie
          </li>
        </ul>
        <p className="text-xs text-text-tertiary">
          Verified securely through Stripe Identity. We only store the result, not your documents.
        </p>
      </div>

      {error && (
        <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <button
        onClick={handleVerify}
        disabled={loading}
        className="mt-6 w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
      >
        {loading ? "Starting verification..." : "Verify my identity"}
      </button>
    </div>
  );
}
