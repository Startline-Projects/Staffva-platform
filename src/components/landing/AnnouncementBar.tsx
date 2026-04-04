"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const STORAGE_KEY = "staffva_announcement_dismissed";

export default function AnnouncementBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
  }, []);

  function dismiss() {
    setVisible(false);
    localStorage.setItem(STORAGE_KEY, "true");
  }

  if (!visible) return null;

  return (
    <div className="relative z-[60] bg-background border-b border-border-light">
      <div className="mx-auto flex max-w-7xl items-center justify-center px-6 py-2.5">
        <p className="text-xs sm:text-sm text-text text-center">
          Now accepting applications. Zero fees to apply — ever.{" "}
          <Link href="/apply" className="font-semibold text-primary underline underline-offset-2 hover:text-primary-dark transition-colors">
            Apply Now
          </Link>
        </p>
        <button
          onClick={dismiss}
          className="absolute right-4 p-1 text-text/40 hover:text-text/70 transition-colors"
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
