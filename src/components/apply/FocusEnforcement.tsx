"use client";

import { useState, useEffect, useCallback } from "react";

interface Props {
  candidateId: string;
  testSection: string;
  children: React.ReactNode;
}

export default function FocusEnforcement({ candidateId, testSection, children }: Props) {
  const [showOverlay, setShowOverlay] = useState(false);

  const handleMouseLeave = useCallback(() => {
    setShowOverlay(true);

    // Log to API (fire and forget)
    fetch("/api/test/cheat-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateId,
        eventType: "mouse_leave",
        testSection,
      }),
    }).catch(() => {});
  }, [candidateId, testSection]);

  useEffect(() => {
    document.addEventListener("mouseleave", handleMouseLeave);
    return () => document.removeEventListener("mouseleave", handleMouseLeave);
  }, [handleMouseLeave]);

  // Also detect visibility change (tab switch)
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden) {
        handleMouseLeave();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [handleMouseLeave]);

  return (
    <div className="relative">
      {children}

      {/* Warning overlay */}
      {showOverlay && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#1C1B1A]/95">
          <div className="mx-auto max-w-md px-6 text-center">
            {/* Warning icon */}
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-amber-500/20">
              <svg className="h-10 w-10 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>

            <h1 className="text-2xl font-bold text-white">You left the test screen</h1>

            <p className="mt-4 text-sm text-white/70 leading-relaxed">
              Leaving the test screen during your assessment has been noted. Please return your focus to this test.
            </p>

            <button
              onClick={() => setShowOverlay(false)}
              className="mt-8 w-full rounded-full bg-[#FE6E3E] py-3.5 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors"
            >
              Return to Test
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
