"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CandidateData } from "@/app/(main)/apply/page";
import {
  saveProgressLocal,
  loadProgressLocal,
  clearProgressLocal,
  syncProgressToDb,
  startBackgroundSync,
  stopBackgroundSync,
  isMobileBrowser,
  supportsFullscreen,
  type TestProgress,
} from "@/lib/testProgress";

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
  const [showComprehensionTransition, setShowComprehensionTransition] = useState(false);
  const [timerPaused, setTimerPaused] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const questionStartTime = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef<TestProgress | null>(null);

  // Detect mobile on mount
  useEffect(() => {
    setIsMobile(isMobileBrowser());
  }, []);

  // Save progress to localStorage on every state change
  useEffect(() => {
    if (!loading && questions.length > 0) {
      const section = questions[currentIndex]?.section || "grammar";
      const progress: TestProgress = {
        candidateId,
        section,
        questionIndex: currentIndex,
        answers,
        timerRemaining: timeLeft,
        isMobile,
        updatedAt: new Date().toISOString(),
      };
      progressRef.current = progress;
      saveProgressLocal(progress);
    }
  }, [currentIndex, answers, timeLeft, loading, questions, candidateId, isMobile]);

  // Fetch questions on mount + restore progress
  useEffect(() => {
    fetchQuestions();

    // Start background DB sync every 60 seconds
    startBackgroundSync(() => progressRef.current, 60000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopBackgroundSync();
      // Final sync on unmount
      if (progressRef.current) {
        syncProgressToDb(progressRef.current);
      }
    };
  }, []);

  // Start timer (pause during comprehension transition)
  useEffect(() => {
    if (!loading && questions.length > 0 && !timerPaused) {
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
  }, [loading, questions.length, timerPaused]);

  // Anti-cheat: mouse leave, tab switch, paste, fullscreen (mobile-aware)
  useEffect(() => {
    if (loading) return;

    const mobile = isMobileBrowser();

    function logEvent(eventType: string) {
      const supabase = createClient();

      // On mobile, log as mobile_device event instead of strict enforcement
      const finalType = mobile && eventType === "fullscreen_exit" ? "mobile_device" : eventType;

      supabase.from("test_events").insert({
        candidate_id: candidateId,
        event_type: finalType,
        question_number: currentIndex + 1,
      });

      // Mobile gets fewer flags for non-critical events
      if (mobile && (eventType === "mouse_leave" || eventType === "fullscreen_exit")) {
        return; // Don't increment flag count for these on mobile
      }

      setFlagCount((prev) => {
        const newCount = prev + 1;
        if (newCount >= 3) setShowWarning(true);
        return newCount;
      });

      supabase
        .from("candidates")
        .update({ cheat_flag_count: flagCount + 1 })
        .eq("id", candidateId);
    }

    function handleMouseLeave() {
      if (!mobile) logEvent("mouse_leave"); // Skip on mobile — touch events trigger this
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
      // Only enforce on desktop browsers that support fullscreen
      if (!mobile && supportsFullscreen() && !document.fullscreenElement) {
        logEvent("fullscreen_exit");
      }
    }

    document.addEventListener("mouseleave", handleMouseLeave);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("paste", handlePaste);
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    // Log mobile device flag once
    if (mobile) {
      const supabase = createClient();
      supabase.from("test_events").insert({
        candidate_id: candidateId,
        event_type: "mobile_device",
        question_number: 0,
      });
    }

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

    // Try to restore progress from localStorage (same-session refresh)
    const savedProgress = loadProgressLocal();
    if (savedProgress && savedProgress.candidateId === candidateId) {
      setCurrentIndex(savedProgress.questionIndex);
      setAnswers(savedProgress.answers);
      setTimeLeft(savedProgress.timerRemaining > 0 ? savedProgress.timerRemaining : TOTAL_TIME);
    } else {
      // Record test start (new session)
      const supabase = createClient();
      await supabase
        .from("candidates")
        .update({ test_started_at: new Date().toISOString() })
        .eq("id", candidateId);
    }

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

    // Clean up progress — test is done
    clearProgressLocal();
    stopBackgroundSync();

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
      const nextIndex = currentIndex + 1;
      const nextQuestion = questions[nextIndex];
      const currentQuestion = questions[currentIndex];

      // Show comprehension transition when moving from grammar to comprehension
      if (currentQuestion.section === "grammar" && nextQuestion.section === "comprehension") {
        setTimerPaused(true);
        if (timerRef.current) clearInterval(timerRef.current);
        setShowComprehensionTransition(true);
        setCurrentIndex(nextIndex);
        return;
      }

      setCurrentIndex(nextIndex);
    } else {
      submitTest();
    }
  }

  function handleComprehensionContinue() {
    setShowComprehensionTransition(false);
    setTimerPaused(false);
    questionStartTime.current = Date.now();

    // Sync to DB on section transition (grammar → comprehension)
    if (progressRef.current) {
      syncProgressToDb(progressRef.current);
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
  const firstComprehensionIndex = questions.findIndex((q) => q.section === "comprehension");
  const isFirstComprehension = currentIndex === firstComprehensionIndex;
  const progress = ((currentIndex + 1) / questions.length) * 100;

  // Comprehension transition screen
  if (showComprehensionTransition) {
    return (
      <div className="min-h-screen bg-white">
        <div className="mx-auto max-w-2xl px-6 py-16 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
            <svg className="h-8 w-8 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-text">
            Read carefully — this passage will only appear once
          </h1>
          <div className="mt-6 mx-auto max-w-lg text-left space-y-4">
            <p className="text-text/70">
              The following passage will be visible during the <strong>first question only</strong>.
              All remaining questions are about this same passage.
            </p>
            <p className="text-text/70">
              You <strong>cannot go back</strong> to re-read it.
            </p>
            <p className="text-text/70">
              Take your time reading the passage carefully when it appears. The timer will resume
              when you click Continue.
            </p>
          </div>
          <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Timer paused — {formatTime(timeLeft)} remaining
          </div>
          <div className="mt-8">
            <button
              onClick={handleComprehensionContinue}
              className="rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
            >
              Continue to Reading Passage
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Timer bar */}
      <div className="sticky top-0 z-50 border-b border-gray-200 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <span className="text-sm text-text/60">
            Question {currentIndex + 1} of {questions.length}
            {isComprehension && (
              <span className="ml-2 text-xs text-primary font-medium">• Comprehension</span>
            )}
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
        {/* Comprehension passage — only on first comprehension question */}
        {isComprehension && isFirstComprehension && (
          <div className="mb-8 rounded-lg border border-amber-200 bg-amber-50 p-6">
            <div className="flex items-center gap-2 mb-3">
              <svg className="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                Reading Passage — visible on this question only
              </h3>
            </div>
            <p className="text-sm leading-relaxed text-text/80">
              {COMPREHENSION_PASSAGE}
            </p>
          </div>
        )}

        {/* Reminder for subsequent comprehension questions */}
        {isComprehension && !isFirstComprehension && (
          <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs text-text/50 italic">
              Answer based on the passage you read in the previous question. You cannot go back.
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
