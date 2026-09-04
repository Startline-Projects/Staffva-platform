"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface LockoutData {
  locked: boolean;
  permanent: boolean;
  lockout_expires_at: string | null;
  attempt_number: number;
}

export default function LockoutCard() {
  const [data, setData] = useState<LockoutData | null>(null);
  const [countdown, setCountdown] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/test/lockout-status");
        if (res.ok) {
          const d = await res.json();
          setData(d);
        }
      } catch { /* silent */ }
      setLoading(false);
    }
    load();
  }, []);

  // Countdown timer
  useEffect(() => {
    if (!data?.locked || data.permanent || !data.lockout_expires_at) return;

    function updateCountdown() {
      const now = Date.now();
      const expires = new Date(data!.lockout_expires_at!).getTime();
      const diff = expires - now;

      if (diff <= 0) {
        setCountdown("Lockout expired — refresh to retake");
        setData((prev) => prev ? { ...prev, locked: false } : null);
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      const parts = [];
      if (days > 0) parts.push(`${days}d`);
      if (hours > 0) parts.push(`${hours}h`);
      parts.push(`${mins}m`);

      setCountdown(parts.join(" "));
    }

    updateCountdown();
    const interval = setInterval(updateCountdown, 60000);
    return () => clearInterval(interval);
  }, [data]);

  if (loading || !data || !data.locked) return null;

  if (data.permanent) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 mb-6">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100">
            <svg className="h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-red-800">English Assessment Permanently Locked</h3>
            <p className="mt-1 text-sm text-red-700">
              After {data.attempt_number} attempts, your English assessment access has been suspended.
              Contact <a href="mailto:support@staffva.com" className="underline">support@staffva.com</a> if you believe this is an error.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const expiryFormatted = data.lockout_expires_at
    ? new Date(data.lockout_expires_at).toLocaleDateString("en-US", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : "soon";

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 mb-6">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100">
          <svg className="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-amber-800">English Assessment Locked</h3>
          <p className="mt-1 text-sm text-amber-700">
            Your English assessment is currently locked. You may retake on <strong>{expiryFormatted}</strong>.
          </p>

          {/* Countdown */}
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-100 px-3 py-2">
            <svg className="h-4 w-4 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-mono font-semibold text-amber-800">{countdown}</span>
            <span className="text-xs text-amber-600">remaining</span>
          </div>

          <p className="mt-3 text-xs text-amber-600">
            Attempt {data.attempt_number} of 5. Use this time to review grammar and reading comprehension before your retake.
          </p>

          {!data.locked && (
            <Link
              href="/apply"
              className="mt-3 inline-block rounded-lg bg-[#FE6E3E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#E55A2B]"
            >
              Retake English Assessment
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
