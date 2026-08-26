"use client";

import { useState, useEffect } from "react";

interface Props {
  onPass: () => void;
}

const MIN_WIDTH = 1024;

/**
 * Why this device is or is not usable. Pure, so it can be re-run cheaply on
 * every resize.
 */
function evaluateDevice(): "mobile" | "screen" | "touch" | null {
  const ua = navigator.userAgent.toLowerCase();

  // "mobile" was spelled "hrbile" here, so the single most common token in a
  // phone user-agent string was never matched.
  const isMobile = /mobile|android|iphone|ipod|blackberry|windows phone/i.test(ua);
  const isTablet = /tablet|ipad/i.test(ua);
  if (isMobile || isTablet) return "mobile";

  if (window.innerWidth < MIN_WIDTH) return "screen";

  // Touch-only: a coarse pointer with no fine pointer available.
  const hasCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const hasFinePointer = window.matchMedia("(pointer: fine)").matches;
  if (hasCoarsePointer && !hasFinePointer) return "touch";

  return null;
}

export default function DeviceCheck({ onPass }: Props) {
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState(false);
  const [failReason, setFailReason] = useState("");
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    // Re-evaluate on resize.
    //
    // This ran ONCE on mount with no listener and no retry, so a candidate on a
    // real laptop whose window happened to be narrower than 1024px was told to
    // "return on a compatible device" — and widening the window changed nothing,
    // because the component had already decided. They were sitting at a machine
    // that would have worked.
    let frame = 0;
    const run = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const reason = evaluateDevice();
        setWidth(window.innerWidth);
        setChecking(false);
        if (reason) {
          setFailed(true);
          setFailReason(reason);
        } else {
          setFailed(false);
          setFailReason("");
          onPass();
        }
      });
    };

    run();
    window.addEventListener("resize", run);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", run);
    };
    // onPass is stable in practice; re-subscribing on every render would thrash
    // the listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        {/* A too-narrow window on a real computer is a different problem from
            an unsupported device, and telling someone at a working laptop to
            "return on a compatible device" sends them away for no reason. */}
        {failReason === "screen" ? (
          <>
            <h1 className="text-2xl font-bold text-text">Make your window wider</h1>
            <p className="mt-3 text-text/60">
              You are on a supported computer — the browser window is just too
              narrow for the test. Maximise it, or drag it wider, and this will
              continue on its own. Your application is saved.
            </p>
            <p className="mt-4 text-sm text-text/40">
              Window width{" "}
              <span className="font-semibold text-amber-600">
                {width ?? "—"}px
              </span>{" "}
              &mdash; needs {MIN_WIDTH}px.
            </p>
            <p className="mt-1 text-xs text-text/30">
              If your window is already maximised, try zooming out with
              Ctrl/Cmd&nbsp;and&nbsp;&minus;.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-text">Desktop Required</h1>
            <p className="mt-3 text-text/60">
              This test must be completed on a desktop or laptop computer with a
              keyboard. Your application has been saved — please return on a
              compatible device to continue.
            </p>
          </>
        )}
      </div>
    );
  }

  return null;
}
