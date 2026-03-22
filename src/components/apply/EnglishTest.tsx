"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CandidateData } from "@/app/(main)/apply/page";

interface TestQuestion {
  id: string;
  section: string;
  question_text: string;
  options: string[];
  shuffled_indices: number[];
}

interface Props {
  candidateId: string;
  onComplete: (passed: boolean, updatedCandidate: CandidateData) => void;
}

const TOTAL_TIME = 15 * 60; // 15 minutes in seconds
const COMPREHENSION_PASSAGE = `Our client submitted a request last Tuesday asking for a revised version of the contract. The original document included a clause that both parties had agreed to remove during the last call. Since then, our team has been waiting on confirmation from the legal department before sending the updated file. We want to make sure all changes are reviewed and approved before anything is shared externally. Please follow up with the client to let them know we expect to have everything ready by end of week.`;

export default function EnglishTest({ candidateId, onComplete }: Props) {
  const [questions, setQuestions] = useState<TestQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [timeLeft, setTimeLeft] = useState(TOTAL_TIME);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [flagCount, setFlagCount] = useState(0);
  const [showWarning, setShowWarning] = useState(false);
  const questionStartTime = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch questions on mount
  useEffect(() => {
    fetchQuestions();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Start timer
  useEffect(() => {
    if (!loading && questions.length > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            submitTest();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loading, questions.length]);

  // Anti-cheat: mouse leave, tab switch, paste, fullscreen
  useEffect(() => {
    if (loading) return;

    function logEvent(eventType: string) {
      const supabase = createClient();
      supabase.from("test_events").insert({
        candidate_id: candidateId,
        event_type: eventType,
        question_number: currentIndex + 1,
      });

      setFlagCount((prev) => {
        const newCount = prev + 1;
        if (newCount >= 3) setShowWarning(true);
        return newCount;
      });

      // Update cheat count on candidate
      supabase
        .from("candidates")
        .update({ cheat_flag_count: flagCount + 1 })
        .eq("id", candidateId);
    }

    function handleMouseLeave() {
      logEvent("mouse_leave");
    }

    function handleVisibilityChange() {
      if (document.hidden) logEvent("tab_switch");
    }

    function handlePaste(e: Event) {
      e.preventDefault();
      logEvent("paste_attempt");
    }

    function handleContextMenu(e: Event) {
      e.preventDefault();
      logEvent("paste_attempt");
    }

    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "v")) {
        e.preventDefault();
        logEvent("paste_attempt");
      }
    }

    function handleFullscreenChange() {
      if (!document.fullscreenElement) {
        logEvent("fullscreen_exit");
      }
    }

    document.addEventListener("mouseleave", handleMouseLeave);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("paste", handlePaste);
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("mouseleave", handleMouseLeave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("paste", handlePaste);
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [loading, currentIndex, candidateId, flagCount]);

  async function fetchQuestions() {
    const res = await fetch("/api/test/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId }),
    });

    if (!res.ok) {
      return;
    }

    const data = await res.json();
    setQuestions(data.questions);

    // Record test start
    const supabase = createClient();
    await supabase
      .from("candidates")
      .update({ test_started_at: new Date().toISOString() })
      .eq("id", candidateId);

    setLoading(false);
    questionStartTime.current = Date.now();
  }

  const submitTest = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);

    if (timerRef.current) clearInterval(timerRef.current);

    // Track time on last question
    await trackQuestionTime();

    const res = await fetch("/api/test/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateId,
        answers,
        timeRemaining: timeLeft,
      }),
    });

    const result = await res.json();

    // Exit fullscreen
    document.exitFullscreen?.().catch(() => {});

    onComplete(result.passed, result.candidate);
  }, [submitting, candidateId, answers, timeLeft, onComplete]);

  async function trackQuestionTime() {
    if (!questions[currentIndex]) return;
    const elapsed = Math.round((Date.now() - questionStartTime.current) / 1000);
    const supabase = createClient();
    await supabase.from("question_time_tracking").insert({
      candidate_id: candidateId,
      question_id: questions[currentIndex].id,
      time_spent_seconds: elapsed,
    });
  }

  async function handleAnswer(shuffledIndex: number) {
    const question = questions[currentIndex];
    // Map shuffled index back to original index
    const originalIndex = question.shuffled_indices[shuffledIndex];

    setAnswers((prev) => ({
      ...prev,
      [question.id]: originalIndex,
    }));

    // Track time spent
    await trackQuestionTime();
    questionStartTime.current = Date.now();

    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      submitTest();
    }
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-73px)] items-center justify-center">
        <p className="text-text/60">Loading test questions...</p>
      </div>
    );
  }

  const question = questions[currentIndex];
  const isComprehension = question?.section === "comprehension";
  const progress = ((currentIndex + 1) / questions.length) * 100;

  return (
    <div className="min-h-screen bg-white">
      {/* Timer bar */}
      <div className="sticky top-0 z-50 border-b border-gray-200 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <span className="text-sm text-text/60">
            Question {currentIndex + 1} of {questions.length}
          </span>
          <span
            className={`font-mono text-lg font-bold ${
              timeLeft <= 60 ? "text-red-600" : "text-text"
            }`}
          >
            {formatTime(timeLeft)}
          </span>
        </div>
        {/* Progress bar */}
        <div className="mx-auto mt-2 h-1 max-w-3xl rounded-full bg-gray-200">
          <div
            className="h-1 rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Warning banner */}
      {showWarning && (
        <div className="bg-amber-50 px-6 py-3 text-center text-sm text-amber-800 border-b border-amber-200">
          Unusual activity detected. Please stay on this page and complete the
          test without switching tabs or leaving the window.
        </div>
      )}

      <div className="mx-auto max-w-3xl px-6 py-8">
        {/* Comprehension passage */}
        {isComprehension && currentIndex === questions.findIndex((q) => q.section === "comprehension") && (
          <div className="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-6">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text/40">
              Reading Passage
            </h3>
            <p className="text-sm leading-relaxed text-text/80">
              {COMPREHENSION_PASSAGE}
            </p>
          </div>
        )}

        {/* Question */}
        <div>
          <h2 className="text-lg font-medium text-text">
            {question.question_text}
          </h2>

          <div className="mt-6 space-y-3">
            {question.options.map((option, idx) => (
              <button
                key={idx}
                onClick={() => handleAnswer(idx)}
                className="flex w-full items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-left text-sm text-text hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-300 text-xs font-medium">
                  {String.fromCharCode(65 + idx)}
                </span>
                <span>{option}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
