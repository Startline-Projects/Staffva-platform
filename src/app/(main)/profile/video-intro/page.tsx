"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import VideoIntroRecorder from "@/components/apply/VideoIntroRecorder";

const INSTRUCTIONS = [
  { num: 1, title: "Greeting", text: "Greet the viewer using your first name only. Keep it warm and professional." },
  { num: 2, title: "Professional Background", text: "Briefly describe your professional background — years of experience, key industries, and your area of expertise." },
  { num: 3, title: "What You Bring to a Client", text: "Explain the value you bring — what problems you solve, what you excel at, and why a client should choose you." },
  { num: 4, title: "Direct Close", text: "End with a direct closing statement — express your interest in working with the viewer and invite them to reach out." },
];

const TIPS = [
  {
    title: "Setup",
    items: [
      "Use a quiet, well-lit space with a clean background",
      "Position the camera at eye level — not looking up or down",
      "Ensure stable internet if recording in-browser",
      "Use natural light facing you, not behind you",
    ],
  },
  {
    title: "Appearance",
    items: [
      "Wear professional or business casual clothing",
      "Keep your background clean and distraction-free",
      "Avoid hats, sunglasses, or anything that obscures your face",
      "Present yourself as you would for a client meeting",
    ],
  },
  {
    title: "Delivery",
    items: [
      "Speak clearly and at a moderate pace",
      "Look directly at the camera — not at yourself on screen",
      "Smile naturally — you want to appear approachable",
      "Keep it between 30 and 90 seconds — concise and focused",
    ],
  },
  {
    title: "What to Avoid",
    items: [
      "Do not share your last name, phone number, or email",
      "Do not mention specific client names or companies",
      "Do not use background music or filters",
      "Do not read from a script — conversational is best",
    ],
  },
];

export default function VideoIntroPage() {
  const [phase, setPhase] = useState<"instructions" | "upload">("instructions");
  const [guidelinesChecked, setGuidelinesChecked] = useState(false);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [expandedTip, setExpandedTip] = useState<number | null>(null);
  const instructionsRef = useRef<HTMLDivElement>(null);

  // Upload state
  // Server-owned; the candidate cannot grant themselves more (00180 revokes
  // UPDATE on the column). Read on mount alongside the rest of the profile.
  const [takesRemaining, setTakesRemaining] = useState(2);
  const [success, setSuccess] = useState(false);

  // Scroll tracking for instructions
  const handleScroll = useCallback(() => {
    const el = instructionsRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      setHasScrolledToBottom(true);
    }
  }, []);

  // Check if already submitted
  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/candidate/video-intro");
        const data = await res.json();
        if (typeof data.takes_remaining === "number") {
          setTakesRemaining(data.takes_remaining);
        }
        if (data.video_intro_status === "pending_review") {
          setSuccess(true);
          setPhase("upload");
        }
      } catch { /* silent */ }
    }
    check();
  }, []);

  // Camera and object-URL cleanup belong to VideoIntroRecorder now — it owns
  // the stream and the blobs. Nothing on this page holds media any more.





  // ═══ UPLOAD TO SUPABASE ═══


  // ═══ INSTRUCTIONS PHASE ═══
  if (phase === "instructions") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="text-2xl font-bold text-text">Video Introduction</h1>
        <p className="mt-1 text-sm text-text-muted">
          A 30-90 second video that introduces you to potential clients. Candidates with a video introduction attract significantly more attention.
        </p>

        <div
          ref={instructionsRef}
          onScroll={handleScroll}
          className="mt-6 max-h-[60vh] overflow-y-auto"
        >
          {/* What to cover */}
          <div className="rounded-xl border border-border-light bg-card p-6">
            <h2 className="text-sm font-semibold text-text uppercase tracking-wider mb-4">What to Cover (In Order)</h2>
            <div className="space-y-4">
              {INSTRUCTIONS.map((item) => (
                <div key={item.num} className="flex gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                    {item.num}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text">{item.title}</p>
                    <p className="mt-0.5 text-xs text-text-muted">{item.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tips accordion */}
          <div className="mt-4 space-y-2">
            {TIPS.map((tip, i) => (
              <div key={i} className="rounded-xl border border-border-light bg-card overflow-hidden">
                <button
                  onClick={() => setExpandedTip(expandedTip === i ? null : i)}
                  className="flex w-full items-center justify-between p-4 text-left"
                >
                  <span className="text-sm font-semibold text-text">{tip.title}</span>
                  <svg
                    className={`h-4 w-4 text-text-muted transition-transform ${expandedTip === i ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
                {expandedTip === i && (
                  <div className="px-4 pb-4">
                    <ul className="space-y-1.5">
                      {tip.items.map((item, j) => (
                        <li key={j} className="flex items-start gap-2 text-xs text-text-muted">
                          <svg className="mt-0.5 h-3 w-3 shrink-0 text-primary" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" /></svg>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Spacer to ensure scrollability */}
          <div className="h-4" />
        </div>

        {/* Gate */}
        <div className="mt-6 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={guidelinesChecked}
              onChange={(e) => setGuidelinesChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <span className="text-xs text-text-muted">
              I have read the guidelines and understand only my first name may be used in this video.
            </span>
          </label>

          <button
            onClick={() => setPhase("upload")}
            disabled={!hasScrolledToBottom || !guidelinesChecked}
            className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Record or Upload Your Video Introduction
          </button>
        </div>
      </div>
    );
  }

  // ═══ SUCCESS STATE ═══
  if (success) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-text">Video Submitted</h1>
        <p className="mt-2 text-sm text-text-muted">
          Your video introduction is under review. A StaffVA specialist looks at it with the rest of your profile — usually within a few business days.
        </p>
        <Link
          href="/candidate/dashboard"
          className="mt-6 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  // ═══ UPLOAD PHASE ═══
  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-bold text-text">Record Your Video</h1>
      <p className="mt-1 text-sm text-text-muted">
        About 75 seconds, recorded here in your browser. Four short prompts, one continuous take.
      </p>

      {/* The prompted recorder. The record/upload tabs are gone: an uploaded
          file cannot have been recorded against timed prompts, and telling a
          candidate on variable bandwidth that they get two takes while a
          neighbouring tab accepts unlimited re-edits is unfair to whichever
          of them believes it. */}
      <VideoIntroRecorder
        takesRemaining={takesRemaining}
        onSaved={(remaining) => {
          setTakesRemaining(remaining);
          // The success screen is the `success` branch, which is what the
          // already-submitted check also renders. Routing to a "submitted"
          // phase with no matching branch showed a blank page after a save
          // that had actually worked.
          setSuccess(true);
        }}
      />

    </div>
  );
}
