"use client";

import { useEffect, useRef, useState } from "react";
import type { DailyCall } from "@daily-co/daily-js";

/**
 * The embedded video call. Mounting this component asks the server for the
 * room and the viewer's own token, then drops Daily Prebuilt into the
 * container — camera/mic check first, then the call. daily-js is browser-only
 * so it is imported inside the effect, never at module scope.
 */

interface Props {
  bookingId: string;
  onLeft: () => void;
}

export default function InterviewCall({ bookingId, onLeft }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);
  const onLeftRef = useRef(onLeft);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(true);

  useEffect(() => {
    onLeftRef.current = onLeft;
  }, [onLeft]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const res = await fetch(`/api/interviews/${bookingId}/room`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        setError(data.error || "We couldn't start the video room — try again in a moment.");
        setConnecting(false);
        return;
      }

      const DailyIframe = (await import("@daily-co/daily-js")).default;
      if (cancelled || !containerRef.current) return;

      const frame = DailyIframe.createFrame(containerRef.current, {
        iframeStyle: { width: "100%", height: "100%", border: "0" },
        showLeaveButton: true,
        showFullscreenButton: true,
      });
      callRef.current = frame;
      setConnecting(false);

      frame.on("left-meeting", () => {
        callRef.current = null;
        // Finish tearing down before telling the parent — a quick Rejoin
        // must not race a half-destroyed frame into createFrame's
        // one-instance rule.
        frame
          .destroy()
          .catch(() => {})
          .finally(() => onLeftRef.current());
      });

      try {
        await frame.join({ url: data.url, token: data.token });
      } catch {
        if (!cancelled) setError("The call could not connect — check your network and try again.");
      }
    }
    // A failed room fetch, a chunk that won't load, a frame that won't
    // create — all of them end at the error card, never a stuck spinner.
    run().catch(() => {
      if (!cancelled) {
        setConnecting(false);
        setError("We couldn't start the video call — check your connection and try again.");
      }
    });

    return () => {
      cancelled = true;
      callRef.current?.destroy().catch(() => {});
      callRef.current = null;
    };
  }, [bookingId]);

  if (error) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-text">{error}</p>
        <button
          onClick={() => onLeftRef.current()}
          className="mt-3 rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-text-secondary hover:border-gray-400"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 rounded-t-xl border border-b-0 border-gray-200 bg-gray-50 px-4 py-2.5">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-hidden />
        <p className="text-xs text-text-secondary">
          This interview is recorded and reviewed to keep StaffVA safe for both sides.
        </p>
      </div>
      <div
        ref={containerRef}
        className="relative h-[70vh] min-h-[480px] overflow-hidden rounded-b-xl border border-gray-200 bg-gray-900"
      >
        {connecting && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
            Connecting…
          </p>
        )}
      </div>
    </div>
  );
}
