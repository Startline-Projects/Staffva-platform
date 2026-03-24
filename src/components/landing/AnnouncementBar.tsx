"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const STORAGE_KEY = "staffva_announcement_dismissed";

export default function AnnouncementBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (!dismissed) {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    setVisible(false);
    localStorage.setItem(STORAGE_KEY, "true");
  }

  if (!visible) return null;

  return (
    <div className="relative z-[60] bg-[#FAFAFA] border-b border-gray-200">
      <div className="mx-auto flex max-w-7xl items-center justify-center px-6 py-2.5">
        <p className="text-xs sm:text-sm text-[#1C1B1A] text-center">
          Now accepting applications from paralegals, bookkeepers, and legal
          assistants. Zero fees. Ever.{" "}
          <Link
            href="/apply"
            className="font-semibold text-primary underline underline-offset-2 hover:text-primary-dark transition-colors"
          >
            Apply Now
          </Link>
        </p>
        <button
          onClick={dismiss}
          className="absolute right-4 p-1 text-[#1C1B1A]/40 hover:text-[#1C1B1A]/70 transition-colors"
          aria-label="Dismiss announcement"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
