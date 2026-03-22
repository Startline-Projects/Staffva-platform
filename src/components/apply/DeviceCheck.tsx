"use client";

import { useState, useEffect } from "react";

interface Props {
  onPass: () => void;
}

export default function DeviceCheck({ onPass }: Props) {
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState(false);
  const [failReason, setFailReason] = useState("");

  useEffect(() => {
    checkDevice();
  }, []);

  function checkDevice() {
    const ua = navigator.userAgent.toLowerCase();
    const isMobile =
      /mobile|android|iphone|ipad|ipod|blackberry|windows phone/i.test(ua);
    const isTablet = /tablet|ipad/i.test(ua);

    if (isMobile || isTablet) {
      setFailed(true);
      setFailReason("mobile");
      setChecking(false);
      return;
    }

    if (window.innerWidth < 1024) {
      setFailed(true);
      setFailReason("screen");
      setChecking(false);
      return;
    }

    // Touch-only check: if no mouse/pointer events are available and only touch
    const hasCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const hasFinePointer = window.matchMedia("(pointer: fine)").matches;
    if (hasCoarsePointer && !hasFinePointer) {
      setFailed(true);
      setFailReason("touch");
      setChecking(false);
      return;
    }

    setChecking(false);
    onPass();
  }

  if (checking) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <p className="text-text/60">Checking device compatibility...</p>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
          <svg
            className="h-8 w-8 text-amber-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-text">Desktop Required</h1>
        <p className="mt-3 text-text/60">
          This test must be completed on a desktop or laptop computer with a
          keyboard. Your application has been saved — please return on a
          compatible device to continue.
        </p>
        {failReason === "screen" && (
          <p className="mt-2 text-sm text-text/40">
            Your screen width is below the minimum 1024px required.
          </p>
        )}
      </div>
    );
  }

  return null;
}
