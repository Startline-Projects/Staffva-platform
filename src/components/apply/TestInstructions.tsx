"use client";

import { useState, useEffect } from "react";

interface Props {
  onStart: () => void;
}

export default function TestInstructions({ onStart }: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    function handleKeyPress() {
      setReady(true);
    }
    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, []);

  useEffect(() => {
    if (ready) {
      // Request fullscreen
      document.documentElement.requestFullscreen?.().catch(() => {
        // Fullscreen not supported or denied — continue anyway
      });
      onStart();
    }
  }, [ready, onStart]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-text">English Assessment</h1>
      <p className="mt-2 text-text/60">
        Please read the following instructions carefully before beginning.
      </p>

      <div className="mt-8 space-y-4 rounded-xl border border-gray-200 bg-card p-6">
        <h2 className="font-semibold text-text">Test Structure</h2>
        <ul className="space-y-3 text-sm text-text/80">
          <li className="flex gap-3">
            <span className="font-semibold text-primary">1.</span>
            <span>
              <strong>Grammar (20 questions)</strong> — Multiple choice
              questions testing written grammar and syntax.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-semibold text-primary">2.</span>
            <span>
              <strong>Reading Comprehension (5 questions)</strong> — Read a
              passage and answer questions about it.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-semibold text-primary">3.</span>
            <span>
              <strong>Voice Recording 1</strong> — Read a passage out loud (after
              passing the written sections).
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-semibold text-primary">4.</span>
            <span>
              <strong>Voice Recording 2</strong> — Record a guided self
              introduction.
            </span>
          </li>
        </ul>

        <div className="border-t border-gray-200 pt-4">
          <h2 className="font-semibold text-text">Rules</h2>
          <ul className="mt-2 space-y-2 text-sm text-text/80">
            <li>
              You have <strong>15 minutes</strong> for Sections 1 and 2
              combined. The timer starts when you begin.
            </li>
            <li>One question at a time — you cannot go back to previous questions.</li>
            <li>The test auto-submits when the timer reaches zero.</li>
            <li>
              Right-click, copy/paste, and tab switching are monitored and
              flagged.
            </li>
            <li>
              The test runs in fullscreen mode. Exiting fullscreen will be
              flagged.
            </li>
            <li>
              You must score at least <strong>70%</strong> on both grammar and
              comprehension to pass.
            </li>
            <li>Voice recordings are one take only — no re-records.</li>
          </ul>
        </div>

        <div className="border-t border-gray-200 pt-4">
          <h2 className="font-semibold text-text">Passing Threshold</h2>
          <p className="mt-1 text-sm text-text/80">
            70% on grammar AND 70% on comprehension. If you do not pass, you may
            retake the test once after 7 days.
          </p>
        </div>
      </div>

      <div className="mt-8 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-8 text-center">
        <p className="text-lg font-semibold text-text">
          Press any key to begin
        </p>
        <p className="mt-2 text-sm text-text/60">
          The timer will start as soon as you press a key. Make sure you are
          ready.
        </p>
      </div>
    </div>
  );
}
