"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StaffvaLogo from "@/components/landing/StaffvaLogo";
import Asti, { AstiPointChip } from "@/components/landing/Asti";
import { useProctorSession } from "./useProctorSession";
import "@/app/landing.css";
import "@/app/atlas-auth.css";

type Stage =
  | "consent"
  | "preflight"
  | "rules"
  | "scan"
  | "start"
  | "test"
  | "grading"
  | "grading_failed"
  | "done_pass"
  | "done_fail"
  | "camera_denied";

interface ClientQuestion {
  id: string;
  section: string;
  question_text: string;
  options: string[];
  seconds: number | null;
  min_words: number | null;
  max_words: number | null;
  audio?: string | null;
}

interface DealResponse {
  attemptId: string;
  expiresAt: string;
  passage: string | null;
  questions: ClientQuestion[];
  locked?: boolean;
  permanent?: boolean;
  lockout_expires_at?: string | null;
  error?: string;
}

const SECTION_SECONDS: Record<string, number> = { grammar: 25, comprehension: 45 };
const SECTION_TAGS: Record<string, string> = {
  grammar: "Grammar",
  comprehension: "Reading",
  read_aloud: "Read aloud",
  listening: "Listen & respond",
  speaking: "Speak",
  writing: "Write",
};
/** The client submits this long before the server's hard deadline, so a slow
 * network can't turn a finished test into a 410. */
const DEADLINE_SAFETY_MS = 120_000;
const MIN_RECORDING_MS = 2_000;
const MAX_AUDIO_PLAYS = 2;

// Pacing guidance for the rotation, not verification claims: the scan is a
// RECORDING a human reviewer can watch, and nothing here inspects it live.
const SCAN_STAGES = [
  { at: 600, text: "Start turning slowly to your left…" },
  { at: 2000, text: "Keep going — about a quarter turn…" },
  { at: 3400, text: "Halfway there — keep it steady…" },
  { at: 4800, text: "Almost all the way around…" },
  { at: 6200, text: "Done — thanks. The scan is recorded." },
];

function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export default function AssessmentClient({
  candidateId,
  mode,
  pendingAttemptId = null,
  spokenParts,
  writingPart,
  retakeAvailableAt,
  tier,
}: {
  candidateId: string;
  mode: "run" | "passed" | "cooldown" | "blocked" | "grade_retry";
  pendingAttemptId?: string | null;
  spokenParts: boolean;
  writingPart: boolean;
  retakeAvailableAt: string | null;
  tier: string | null;
}) {
  const router = useRouter();
  const proctor = useProctorSession();

  const [stage, setStage] = useState<Stage>(mode === "grade_retry" ? "grading_failed" : "consent");
  const [consentChecked, setConsentChecked] = useState(false);
  const [rulesChecked, setRulesChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // ── preflight ──
  const [pfState, setPfState] = useState<Record<string, "idle" | "checking" | "passed" | "failed">>(
    { webcam: "idle", mic: "idle", connection: "idle" }
  );
  const [pfDone, setPfDone] = useState(false);
  const [pfFailed, setPfFailed] = useState(false);

  // ── scan ──
  const [scanText, setScanText] = useState("Start rotating slowly…");
  const [scanDone, setScanDone] = useState(false);

  // ── test ──
  const [attemptId, setAttemptId] = useState(pendingAttemptId || "");
  const [questions, setQuestions] = useState<ClientQuestion[]>([]);
  const [passage, setPassage] = useState<string | null>(null);
  const [qIndex, setQIndex] = useState(0);
  const [showPassageIntro, setShowPassageIntro] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [writeText, setWriteText] = useState("");
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [globalLeft, setGlobalLeft] = useState(0);
  const [qLeft, setQLeft] = useState(0);
  const [recState, setRecState] = useState<"idle" | "recording" | "saving">("idle");
  const [audioPlays, setAudioPlays] = useState(0);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [warning, setWarning] = useState<"none" | "soft" | "medium">("none");

  const [uploadFailed, setUploadFailed] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  const [submitBlocked, setSubmitBlocked] = useState<"none" | "network" | "expired">("none");

  const deadlineRef = useRef(0);
  const qDeadlineRef = useRef(0);
  const recordingsRef = useRef<Record<string, string>>({});
  const recorderRef = useRef<{ stop: () => Promise<Blob> } | null>(null);
  const recStartRef = useRef(0);
  const advanceLockRef = useRef(false);
  const finishingRef = useRef(false);
  const flagCountRef = useRef(0);
  const writeTextRef = useRef("");
  const answersRef = useRef<Record<string, number>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const qIndexRef = useRef(0);
  const questionsRef = useRef<ClientQuestion[]>([]);
  const pendingUploadRef = useRef<Promise<boolean> | null>(null);
  const failedBlobRef = useRef<{ eph: string; blob: Blob } | null>(null);
  const uploadFailedRef = useRef(false);
  const audioFlagsRef = useRef<Record<string, string>>({});
  const submittingRef = useRef(false);

  useEffect(() => {
    uploadFailedRef.current = uploadFailed;
  }, [uploadFailed]);

  /** Answers survive a refresh: the server re-serves the SAME attempt with
   * the same ephemeral ids, so state keyed by attemptId restores cleanly.
   * Without this, a mid-test refresh silently wiped every answer while the
   * server clock kept running. */
  const persistProgress = useCallback(() => {
    if (!attemptId) return;
    try {
      localStorage.setItem(
        "sva-assessment-progress",
        JSON.stringify({
          attemptId,
          qIndex: qIndexRef.current,
          answers: answersRef.current,
          writeText: writeTextRef.current,
          recordings: recordingsRef.current,
          audioFlags: audioFlagsRef.current,
        })
      );
    } catch {
      /* storage full/blocked — the server-side attempt still protects most */
    }
     
  }, [attemptId]);

  useEffect(() => {
    writeTextRef.current = writeText;
    persistProgress();
  }, [writeText, persistProgress]);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  useEffect(() => {
    qIndexRef.current = qIndex;
    persistProgress();
  }, [qIndex, persistProgress]);
  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);

  const question = questions[qIndex] as ClientQuestion | undefined;
  const qSeconds = question ? question.seconds ?? SECTION_SECONDS[question.section] ?? 45 : 0;

  // ═══ Stage: preflight — REAL checks only. Three, because three are what
  // we can actually verify; a list padded with theater would be the
  // prototype's fake face-match rows all over again. ═══
  const runPreflight = useCallback(async () => {
    setPfDone(false);
    setPfFailed(false);
    setPfState({ webcam: "checking", mic: "idle", connection: "idle" });
    const ok = await proctor.acquire();
    if (!ok) {
      setPfState((s) => ({ ...s, webcam: "failed" }));
      setStage("camera_denied");
      return;
    }
    const tracks = proctor.hasTracks();
    setPfState((s) => ({ ...s, webcam: tracks.video ? "passed" : "failed", mic: "checking" }));
    // Mic: live track passes; the meter animates while we listen briefly.
    await new Promise((r) => setTimeout(r, 1200));
    setPfState((s) => ({ ...s, mic: tracks.audio ? "passed" : "failed", connection: "checking" }));
    // Connection: an actual round trip, not navigator.onLine theater.
    let online = false;
    try {
      const ping = await fetch("/favicon.ico", { cache: "no-store", method: "HEAD" });
      online = ping.ok || ping.status < 500;
    } catch {
      online = false;
    }
    setPfState((s) => ({ ...s, connection: online ? "passed" : "failed" }));
    if (tracks.video && tracks.audio && online) setPfDone(true);
    else setPfFailed(true);
  }, [proctor]);

  useEffect(() => {
    if (stage === "preflight") runPreflight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // ═══ Stage: scan — the guided 360° while the proctor camera records ═══
  useEffect(() => {
    if (stage !== "scan") return;
    setScanDone(false);
    setScanText("Start rotating slowly…");
    const timers = SCAN_STAGES.map((s) => setTimeout(() => setScanText(s.text), s.at));
    timers.push(setTimeout(() => setScanDone(true), 6800));
    return () => timers.forEach(clearTimeout);
  }, [stage]);

  // ═══ Consent → preflight ═══
  async function handleConsent() {
    if (!consentChecked || busy) return;
    setBusy(true);
    setError("");
    const ok = await proctor.recordConsent();
    setBusy(false);
    if (!ok) {
      setError("We couldn't record your consent — try again.");
      return;
    }
    setStage("preflight");
  }

  // ═══ Rules → scan (the session starts HERE so the scan is recorded) ═══
  async function handleRules() {
    if (!rulesChecked || busy) return;
    setBusy(true);
    setError("");
    const ok = await proctor.startSession();
    setBusy(false);
    if (!ok) {
      setError("We couldn't start the proctored session — try again.");
      return;
    }
    setStage("scan");
  }

  // ═══ Start → deal questions, enter fullscreen ═══
  async function handleStart() {
    if (busy) return;
    setBusy(true);
    setError("");
    document.documentElement.requestFullscreen?.().catch(() => {
      /* windowed mode is tolerated; the exit is logged either way */
    });
    try {
      const res = await fetch("/api/test/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });
      const data = (await res.json()) as DealResponse;
      if (!res.ok || !data.attemptId) {
        setError(data.error || "We couldn't start the assessment. Try again in a moment.");
        setBusy(false);
        return;
      }
      proctor.linkAttempt(data.attemptId);
      setAttemptId(data.attemptId);
      setQuestions(data.questions);
      questionsRef.current = data.questions;
      setPassage(data.passage);
      deadlineRef.current = new Date(data.expiresAt).getTime() - DEADLINE_SAFETY_MS;
      setGlobalLeft(Math.round((deadlineRef.current - Date.now()) / 1000));
      // A refresh resumed the same attempt — pick up where they left off.
      let startIndex = 0;
      try {
        const saved = JSON.parse(localStorage.getItem("sva-assessment-progress") || "null");
        if (saved && saved.attemptId === data.attemptId) {
          answersRef.current = saved.answers || {};
          setAnswers(saved.answers || {});
          writeTextRef.current = saved.writeText || "";
          setWriteText(saved.writeText || "");
          recordingsRef.current = saved.recordings || {};
          audioFlagsRef.current = saved.audioFlags || {};
          startIndex = Math.min(
            typeof saved.qIndex === "number" ? saved.qIndex : 0,
            data.questions.length - 1
          );
        } else {
          localStorage.removeItem("sva-assessment-progress");
        }
      } catch {
        /* fresh start */
      }
      setQIndex(startIndex);
      qIndexRef.current = startIndex;
      setStage("test");
      postEvent("test_started", startIndex + 1);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // ═══ Global timer ═══
  useEffect(() => {
    if (stage !== "test") return;
    const t = setInterval(() => {
      const left = Math.round((deadlineRef.current - Date.now()) / 1000);
      setGlobalLeft(left);
      if (left <= 0) finishTest();
    }, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // ═══ Per-question timer ═══
  useEffect(() => {
    if (stage !== "test" || !question || showPassageIntro) return;
    qDeadlineRef.current = Date.now() + qSeconds * 1000;
    setQLeft(qSeconds);
    setSelectedOption(null);
    setRecState("idle");
    setAudioPlays(0);
    setAudioPlaying(false);
    setAudioFailed(false);
    // Deliberately NOT clearing writeText here: only the writing textarea
    // ever writes it, and clearing on entry destroyed the restored essay
    // when a refresh resumed directly onto the writing question.
    const t = setInterval(() => {
      const left = Math.round((qDeadlineRef.current - Date.now()) / 1000);
      setQLeft(left);
      if (left <= 0) {
        clearInterval(t);
        onQuestionTimeout();
      }
    }, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, qIndex, showPassageIntro]);

  // ═══ Integrity telemetry (ported from the old runner: the ONE ingest) ═══
  const postEvent = useCallback(
    (type: string, questionNumber: number, extra?: Record<string, unknown>) => {
      fetch("/api/proctor/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionKind: "english_test",
          events: [
            { type, question_number: questionNumber, at: new Date().toISOString(), ...extra },
          ],
        }),
      }).catch(() => {});
    },
    []
  );

  useEffect(() => {
    if (stage !== "test") return;
    const mobile = isMobileBrowser();
    let leaveId: string | null = null;
    let leaveAt = 0;

    const bumpFlags = () => {
      flagCountRef.current++;
      if (flagCountRef.current >= 5) setWarning("medium");
      else if (flagCountRef.current >= 3) setWarning((w) => (w === "none" ? "soft" : w));
    };
    const logLeave = (rawType: string) => {
      const type = mobile && rawType === "fullscreen_exit" ? "mobile_device" : rawType;
      const clientEventId = crypto.randomUUID();
      postEvent(type, qIndexRef.current + 1, { client_event_id: clientEventId });
      if (mobile && (rawType === "mouse_leave" || rawType === "fullscreen_exit")) return;
      leaveId = clientEventId;
      leaveAt = Date.now();
      bumpFlags();
    };
    const logReturn = () => {
      if (!leaveId || !leaveAt) return;
      postEvent("focus_return", qIndexRef.current + 1, {
        client_event_id: leaveId,
        duration_ms: Date.now() - leaveAt,
      });
      leaveId = null;
      leaveAt = 0;
    };

    const onVisibility = () => {
      if (document.hidden) logLeave("tab_switch");
      else logReturn();
    };
    const onMouseLeave = () => logLeave("mouse_leave");
    const onMouseEnter = () => logReturn();
    const onFullscreen = () => {
      // Submitting exits fullscreen deliberately — that is not a flag.
      if (!document.fullscreenElement && !submittingRef.current) logLeave("fullscreen_exit");
    };
    const onPaste = (e: Event) => {
      e.preventDefault();
      postEvent("paste_attempt", qIndexRef.current + 1);
    };
    const onContext = (e: Event) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "v")) {
        e.preventDefault();
        postEvent("paste_attempt", qIndexRef.current + 1);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    document.documentElement.addEventListener("mouseleave", onMouseLeave);
    document.documentElement.addEventListener("mouseenter", onMouseEnter);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContext);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.documentElement.removeEventListener("mouseleave", onMouseLeave);
      document.documentElement.removeEventListener("mouseenter", onMouseEnter);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onContext);
      document.removeEventListener("keydown", onKey);
    };
  }, [stage, postEvent]);

  // ═══ Advancing ═══
  // Idempotent PER QUESTION, not time-debounced: every caller says which
  // question it is advancing FROM, and a stale call (the question timer
  // firing during a slow recording save, a double event) is a no-op. The
  // old 450ms debounce let two calls >450ms apart both increment — skipping
  // a question, or auto-submitting an untouched writing part.
  const advance = useCallback((fromIndex: number) => {
    if (qIndexRef.current !== fromIndex || advanceLockRef.current) return;
    advanceLockRef.current = true;
    setTimeout(() => {
      advanceLockRef.current = false;
      if (qIndexRef.current !== fromIndex) return;
      const qs = questionsRef.current;
      const next = fromIndex + 1;
      if (next >= qs.length) {
        // Through the ref: this stable callback would otherwise capture the
        // FIRST render's finishTest, whose attemptId is "" — submitting
        // "Missing data" at the end of every MC-only test.
        finishTestRef.current();
        return;
      }
      // Entering the reading section: show the passage interstitial once.
      if (qs[next].section === "comprehension" && qs[fromIndex].section !== "comprehension") {
        setShowPassageIntro(true);
      }
      setQIndex(next);
    }, 450);
     
  }, []);

  const uploadBlob = useCallback(
    async (eph: string, blob: Blob): Promise<boolean> => {
      const form = new FormData();
      form.append("candidateId", candidateId);
      form.append("attemptId", attemptId);
      form.append("eph", eph);
      form.append("audio", blob, "answer.webm");
      for (let i = 0; i < 3; i++) {
        try {
          const res = await fetch("/api/test/upload-recording", { method: "POST", body: form });
          if (res.ok) {
            const { path } = await res.json();
            recordingsRef.current[eph] = path;
            persistProgress();
            return true;
          }
          if (res.status < 500) return false; // a 4xx won't get better on retry
        } catch {
          /* retry */
        }
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attemptId, candidateId]
  );

  /** Stops the recorder and uploads. Returns true when the answer is safely
   * stored. On failure the blob is HELD for a visible retry — "Saved —
   * moving on" while the answer silently scored 0 is the interview app's
   * silent-rejection bug, and it does not get to happen twice. */
  async function stopAndStoreRecording(q: ClientQuestion): Promise<boolean> {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (!rec) return true;
    setRecState("saving");
    const blob = await rec.stop();
    if (blob.size === 0) return true; // nothing was captured; nothing to lose
    const upload = uploadBlob(q.id, blob);
    pendingUploadRef.current = upload;
    const ok = await upload;
    pendingUploadRef.current = null;
    if (!ok) {
      failedBlobRef.current = { eph: q.id, blob };
      setUploadFailed(true);
      return false;
    }
    return true;
  }

  async function retryFailedUpload() {
    const held = failedBlobRef.current;
    if (!held || busy) return;
    setBusy(true);
    const ok = await uploadBlob(held.eph, held.blob);
    setBusy(false);
    if (ok) {
      failedBlobRef.current = null;
      setUploadFailed(false);
      advance(qIndexRef.current);
    }
  }

  function skipFailedUpload() {
    failedBlobRef.current = null;
    setUploadFailed(false);
    // On the last question this routes into finishTest (via the ref).
    advance(qIndexRef.current);
  }

  // advance() is a stable callback; finishTest is not — the ref bridges them.
  const finishTestRef = useRef<() => void>(() => {});

  function onQuestionTimeout() {
    const idx = qIndexRef.current;
    const q = questionsRef.current[idx];
    if (!q) return;
    if (recorderRef.current) {
      // Auto-stop and keep whatever was said — time up is not evidence lost.
      stopAndStoreRecording(q).then((ok) => {
        if (ok) advance(idx);
      });
      return;
    }
    if (uploadFailedRef.current) return; // the retry card owns the screen
    if (q.section === "writing") {
      finishTest();
      return;
    }
    advance(idx);
  }

  function handleMcSelect(displayIndex: number) {
    if (!question || selectedOption !== null) return;
    const idx = qIndexRef.current;
    setSelectedOption(displayIndex);
    setAnswers((a) => {
      const next = { ...a, [question.id]: displayIndex };
      answersRef.current = next;
      return next;
    });
    persistProgress();
    advance(idx);
  }

  async function handleRecordToggle() {
    if (!question) return;
    const idx = qIndexRef.current;
    if (recState === "recording") {
      if (Date.now() - recStartRef.current < MIN_RECORDING_MS) return;
      const ok = await stopAndStoreRecording(question);
      if (ok) advance(idx);
      return;
    }
    if (recState !== "idle") return;
    const rec = proctor.recordAnswer();
    if (!rec) {
      setError("Your microphone disconnected. Reconnect it to continue.");
      return;
    }
    recorderRef.current = rec;
    recStartRef.current = Date.now();
    setRecState("recording");
  }

  function handleAudioPlay() {
    const el = audioRef.current;
    if (!el || audioPlaying || audioPlays >= MAX_AUDIO_PLAYS) return;
    setAudioPlaying(true);
    el.currentTime = 0;
    el.play()
      .then(() => {
        // The play is only SPENT once it actually starts, and the answer
        // clock pauses for the prompt: the timer extends by the prompt's
        // length so listening twice doesn't halve the answering window.
        setAudioPlays((n) => n + 1);
        if (Number.isFinite(el.duration) && el.duration > 0) {
          qDeadlineRef.current += Math.round(el.duration * 1000);
        }
      })
      .catch(() => {
        setAudioPlaying(false);
        setAudioFailed(true);
        if (question) audioFlagsRef.current[question.id] = "audio_failed";
      });
  }

  // ═══ Finish → submit → grade ═══
  const finishTest = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    submittingRef.current = true; // exiting fullscreen now is not a flag
    // A recording in flight gets kept, and an in-flight save is AWAITED —
    // the global deadline must not race the last spoken answer's upload.
    const q = questionsRef.current[qIndexRef.current];
    if (recorderRef.current && q) {
      const stored = await stopAndStoreRecording(q);
      if (!stored) {
        // The upload failed with the blob held — surface the retry overlay
        // instead of submitting a silent zero and claiming everything is in.
        finishingRef.current = false;
        submittingRef.current = false;
        return;
      }
    } else if (pendingUploadRef.current) {
      await Promise.race([pendingUploadRef.current, new Promise((r) => setTimeout(r, 8000))]);
    }
    const wq = questionsRef.current.find((x) => x.section === "writing");
    postEvent("test_submitted", qIndexRef.current + 1);
    // The answers are collected — the proctored portion is over. Ending here
    // (not per-outcome) also stops the camera from recording forever on the
    // retry screen.
    proctor.endSession();
    document.exitFullscreen?.().catch(() => {});
    setStage("grading");
    try {
      const res = await fetch("/api/test/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          attemptId,
          answers: answersRef.current,
          writeAnswers: wq ? { [wq.id]: writeTextRef.current } : {},
          recordings: recordingsRef.current,
          audioFlags: audioFlagsRef.current,
          timeRemaining: Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000)),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.passed === "boolean") {
        try {
          localStorage.removeItem("sva-assessment-progress");
        } catch { /* fine */ }
        applyResult(data);
        return;
      }
      if (res.ok && data.pending) {
        setStage("grading_failed");
        return;
      }
      if (res.status === 409) {
        // Already submitted (a retry raced the original) — grading owns it.
        await retryGrading();
        return;
      }
      if (res.status === 410 || data.expired) {
        setSubmitBlocked("expired");
        setStage("grading_failed");
        return;
      }
      setError(data.error || "Something went wrong submitting your test.");
      finishingRef.current = false; // a re-submit is legitimate
      setSubmitBlocked("network");
      setStage("grading_failed");
    } catch {
      // The answers NEVER LEFT THE BROWSER — saying "answers are in" here
      // would be a lie. The retry re-runs the whole submit.
      finishingRef.current = false;
      setSubmitBlocked("network");
      setStage("grading_failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, candidateId, postEvent]);

  useEffect(() => {
    finishTestRef.current = finishTest;
  }, [finishTest]);

  const [resultInfo, setResultInfo] = useState<{
    blocked: boolean;
    retakeAt: string | null;
  }>({ blocked: false, retakeAt: null });

  function applyResult(data: {
    passed?: boolean;
    candidate?: { permanently_blocked?: boolean; retake_available_at?: string | null };
  }) {
    setResultInfo({
      blocked: data.candidate?.permanently_blocked === true,
      retakeAt: data.candidate?.retake_available_at || null,
    });
    setStage(data.passed ? "done_pass" : "done_fail");
  }

  async function retryGrading() {
    if (busy) return;
    // A network-failed submit never reached the server — the retry must
    // re-run the SUBMIT, not ask for a grade of answers that aren't there.
    if (submitBlocked === "network") {
      setSubmitBlocked("none");
      setStage("test");
      finishTest();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/test/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, attemptId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.passed === "boolean") {
        applyResult(data);
        return;
      }
      if (data.alreadyGraded) {
        router.push("/candidate/dashboard");
        return;
      }
      if (res.status === 410 || data.expired || data.attemptStatus === "expired") {
        setSubmitBlocked("expired");
        return;
      }
      setError("Scoring is still catching up — give it a minute and try again.");
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (stage !== "done_pass" && stage !== "done_fail") return;
    const t = setTimeout(() => {
      router.push("/candidate/dashboard");
      router.refresh();
    }, 3200);
    return () => clearTimeout(t);
  }, [stage, router]);

  // ═══ Derived display ═══
  const wordCount = writeText.trim().split(/\s+/).filter(Boolean).length;
  const partsLine = [
    "20 grammar questions",
    "a short reading",
    ...(spokenParts ? ["speaking"] : []),
    ...(writingPart ? ["writing"] : []),
  ].join(", ");
  // The clock the candidate is promised must be the clock they get.
  const fullTest = spokenParts || writingPart;
  const clockLabel = fullTest ? "24:30" : "15:00";
  const minutesLabel = fullTest ? "About 25 minutes" : "About 15 minutes";

  const BACK_ARROW = (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M7.5 2.5 4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  // ═══ The fullscreen runner ═══
  if (stage === "test" && question) {
    return (
      <div className="lp lp-auth">
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Geist:wght@300..900&family=Geist+Mono:wght@400..600&display=swap"
          rel="stylesheet"
        />
        <div className="test-fullscreen" role="dialog" aria-label="Proctored English Assessment in progress">
          <header className="test-topbar">
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span className="test-rec-badge">Recording</span>
            </div>
            <div className="test-progress-indicator">
              <span className="q-count">
                <span>{qIndex + 1}</span>/<span>{questions.length}</span>
              </span>
              <span className="test-timer">{fmtClock(globalLeft)}</span>
            </div>
          </header>
          <div className="test-progress-bar">
            <div
              className="test-progress-bar-fill"
              style={{ width: `${(qIndex / questions.length) * 100}%` }}
            ></div>
          </div>
          <div className="test-body">
            {showPassageIntro ? (
              <div className="test-question-card">
                <div className="test-q-tag">Part 2 · Reading</div>
                <div className="test-q-prompt">
                  Read the passage, then answer {questions.filter((x) => x.section === "comprehension").length} questions about it. The passage stays visible.
                </div>
                <div className="test-read-aloud-passage" style={{ fontStyle: "normal" }}>
                  {passage}
                </div>
                <button
                  type="button"
                  className="btn-submit"
                  style={{ marginTop: "18px" }}
                  onClick={() => setShowPassageIntro(false)}
                >
                  <span className="submit-label">Start the questions</span>
                </button>
              </div>
            ) : (
              <div className="test-question-card">
                <div className="test-q-tag">
                  Question {qIndex + 1} · {SECTION_TAGS[question.section] || question.section}
                </div>
                <div className="test-q-prompt">
                  {question.section === "read_aloud"
                    ? "Read the passage below aloud. Take your time and speak naturally."
                    : question.section === "grammar" || question.section === "comprehension"
                      ? question.question_text
                      : question.question_text}
                </div>

                {question.section === "comprehension" && passage && (
                  <div
                    className="test-read-aloud-passage"
                    style={{ fontStyle: "normal", fontSize: "14px", maxHeight: "180px", overflowY: "auto" }}
                  >
                    {passage}
                  </div>
                )}

                {(question.section === "grammar" || question.section === "comprehension") && (
                  <div className="test-mc-options" role="radiogroup">
                    {question.options.map((opt, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`test-mc-option${selectedOption === i ? " selected" : ""}`}
                        onClick={() => handleMcSelect(i)}
                      >
                        <span className="mc-letter">{String.fromCharCode(65 + i)}</span>
                        <span>{opt}</span>
                      </button>
                    ))}
                  </div>
                )}

                {question.section === "read_aloud" && (
                  <div className="test-read-aloud-passage">&ldquo;{question.question_text}&rdquo;</div>
                )}

                {question.section === "listening" && (
                  <>
                    <div className="audio-prompt-player">
                      <button
                        type="button"
                        className="audio-prompt-play"
                        aria-label="Play prompt audio"
                        onClick={handleAudioPlay}
                        disabled={audioPlaying || audioPlays >= MAX_AUDIO_PLAYS}
                        style={audioPlays >= MAX_AUDIO_PLAYS && !audioPlaying ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
                      >
                        {audioPlaying ? (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                            <rect x="3" y="2.5" width="3.4" height="11" rx="1" />
                            <rect x="9.6" y="2.5" width="3.4" height="11" rx="1" />
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                            <path d="M4 2.8v10.4c0 .7.8 1.1 1.4.7l8-5.2a.85.85 0 0 0 0-1.4l-8-5.2c-.6-.4-1.4 0-1.4.7Z" />
                          </svg>
                        )}
                      </button>
                      <div className="audio-prompt-wave" aria-hidden>
                        {Array.from({ length: 40 }, (_, i) => (
                          <span
                            key={i}
                            style={{ height: `${20 + Math.round(50 * Math.sin(i * 0.6) ** 2 + (i % 5) * 4)}%` }}
                          ></span>
                        ))}
                      </div>
                      <span className="audio-prompt-meta">
                        {audioPlays >= MAX_AUDIO_PLAYS ? "No plays left" : `Plays left · ${MAX_AUDIO_PLAYS - audioPlays}`}
                      </span>
                    </div>
                    {audioFailed && (
                      <p style={{ fontSize: "13px", color: "var(--amber)", margin: "-8px 0 14px", textAlign: "center" }}>
                        The prompt audio couldn&apos;t play. If it won&apos;t start, let the timer
                        run — this question won&apos;t count against you.
                      </p>
                    )}
                    {question.audio && (
                      <audio
                        ref={audioRef}
                        src={question.audio}
                        preload="auto"
                        onEnded={() => setAudioPlaying(false)}
                        onError={() => {
                          setAudioPlaying(false);
                          setAudioFailed(true);
                          if (question) audioFlagsRef.current[question.id] = "audio_failed";
                        }}
                      />
                    )}
                  </>
                )}

                {(question.section === "read_aloud" ||
                  question.section === "listening" ||
                  question.section === "speaking") && (
                  <div
                    className="mic-record-area"
                    style={question.section === "speaking" ? { padding: "30px 0" } : undefined}
                  >
                    <button
                      type="button"
                      className={`mic-record-btn${recState === "recording" ? " recording" : ""}`}
                      aria-label={recState === "recording" ? "Stop recording" : "Record your response"}
                      onClick={handleRecordToggle}
                      disabled={recState === "saving"}
                    >
                      {recState === "recording" ? (
                        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
                          <rect x="9" y="9" width="10" height="10" rx="2" fill="currentColor" />
                        </svg>
                      ) : (
                        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
                          <rect x="10.5" y="4" width="7" height="13" rx="3.5" stroke="currentColor" strokeWidth="2" />
                          <path d="M6.5 13a7.5 7.5 0 0 0 15 0M14 20.5V24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      )}
                    </button>
                    <div className="mic-waveform" aria-hidden>
                      {Array.from({ length: 9 }, (_, i) => (
                        <span key={i}></span>
                      ))}
                    </div>
                    <div className="mic-record-label">
                      {recState === "recording"
                        ? "Recording… tap again to stop"
                        : recState === "saving"
                          ? "Saved — moving on…"
                          : question.section === "listening"
                            ? "Tap to answer"
                            : question.section === "speaking"
                              ? "Tap when ready"
                              : "Tap to start recording"}
                    </div>
                  </div>
                )}

                {question.section === "writing" && (
                  <>
                    <textarea
                      className="test-writing-area"
                      placeholder="Start writing here…"
                      spellCheck
                      value={writeText}
                      onChange={(e) => setWriteText(e.target.value)}
                      autoFocus
                    />
                    <div className="test-writing-meta">
                      <span>
                        <span className={`count-current${wordCount >= (question.min_words || 0) ? " met" : ""}`}>
                          {wordCount}
                        </span>{" "}
                        words · min {question.min_words} / max {question.max_words}
                      </span>
                      <button
                        type="button"
                        className="btn-submit"
                        style={{ width: "auto", padding: "10px 22px", marginTop: 0 }}
                        disabled={wordCount < (question.min_words || 0)}
                        onClick={() => finishTest()}
                      >
                        <span className="submit-label">Submit answer</span>
                      </button>
                    </div>
                  </>
                )}

                <div className={`test-q-timer-label${qLeft <= 10 ? " warning" : ""}`}>
                  <span>Time remaining</span>
                  <span className="test-q-timer-track">
                    <span
                      className="test-q-timer-fill"
                      style={{ width: `${Math.max(0, (qLeft / qSeconds) * 100)}%` }}
                    ></span>
                  </span>
                  <span className="q-time-remaining">{fmtClock(qLeft)}</span>
                </div>
              </div>
            )}

            {warning === "soft" && (
              <div className="test-warning-overlay soft" role="alert">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                  <path d="M9 2 1.5 15h15L9 2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  <path d="M9 7v3.5M9 12.6v.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <div>
                  <span className="test-warning-title">Please stay focused on the test</span>
                  <div className="test-warning-body">
                    We noticed you leaving the test window. Repeated departures are flagged for review.
                  </div>
                </div>
                <button className="test-warning-close" aria-label="Dismiss" onClick={() => setWarning("none")}>
                  ×
                </button>
              </div>
            )}
            {warning === "medium" && (
              <div className="test-warning-overlay medium" role="alertdialog">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                  <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M10 6v4.5M10 13.6v.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <div>
                  <span className="test-warning-title">Please stop leaving the test</span>
                  <div className="test-warning-body">
                    Further departures may result in your test being flagged for review or disqualified. Stay
                    focused on the screen.
                  </div>
                  <button className="test-warning-ack-btn" onClick={() => setWarning("none")}>
                    I understand
                  </button>
                </div>
              </div>
            )}

            {uploadFailed && (
              <div className="test-paused-overlay">
                <div className="test-paused-card">
                  <h2>That recording didn&apos;t save</h2>
                  <p>
                    Your connection hiccuped while saving your answer — it&apos;s still held in
                    your browser. Retry now, or skip this part (a skipped recording scores zero).
                  </p>
                  <button
                    type="button"
                    className="state-action-btn"
                    disabled={busy}
                    onClick={retryFailedUpload}
                  >
                    {busy ? "Saving…" : "Retry saving"}
                  </button>
                  <p style={{ marginTop: "12px" }}>
                    <button
                      type="button"
                      className="state-back"
                      onClick={skipFailedUpload}
                      style={{ margin: 0 }}
                    >
                      Skip this recording
                    </button>
                  </p>
                </div>
              </div>
            )}

            <div className="test-pip" aria-hidden>
              <div className="pip-indicator">Recording</div>
              <video
                ref={proctor.registerVideo}
                autoPlay
                muted
                playsInline
                style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
              />
            </div>
          </div>
        </div>

        {proctor.cameraLost && (
          <div className="test-paused-overlay">
            <div className="test-paused-card">
              <h2>Camera disconnected</h2>
              <p>
                The proctored session requires your camera. Reconnect it to continue — the timers keep
                running, and the interruption is noted in the session record.
              </p>
              <button type="button" className="state-action-btn" onClick={() => proctor.reconnectCamera()}>
                Reconnect camera
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══ The framed (non-fullscreen) stages ═══
  const softDismissTimer = warning === "soft"; // (soft warnings only exist in-test)
  void softDismissTimer;

  return (
    <div className="lp lp-auth">
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Geist:wght@300..900&family=Geist+Mono:wght@400..600&display=swap"
        rel="stylesheet"
      />
      <nav className="nav" id="nav">
        <div className="nav-inner">
          <Link href="/" className="logo" aria-label="StaffVA — go to homepage">
            <StaffvaLogo />
          </Link>
          <div className="nav-right">
            <Link href="/candidate/dashboard" className="signin">Dashboard</Link>
          </div>
        </div>
      </nav>

      <main className="page page-narrow">
        <div className="signin-layout" style={{ maxWidth: "560px" }}>
          <header className="signin-header">
            <Link href="/candidate/dashboard" className="back-to-dash">
              {BACK_ARROW}
              Back to dashboard
            </Link>
            <span className="pipeline-step-indicator">
              <span>StaffVA Pipeline</span>
              <span className="pipe-sep" aria-hidden></span>
              <span className="step-num">Step 3 of 10</span>
            </span>
            <h1 className="display">
              Your <span className="serif-italic">Proctored English</span> Assessment.
            </h1>
            <p className="lead">
              {minutesLabel}. Proctored throughout — you&apos;ll stay on camera the entire time.
            </p>
          </header>

          <div className="form-card signin-card">
            {mode === "passed" && (
              <div className="signin-state state-centered">
                <Asti variant="celebrate" size={96} />
                <h2 className="state-title">You already passed.</h2>
                <p className="state-subtitle">
                  Your English assessment is complete{tier ? ` — tier: ${tier}` : ""}. There&apos;s
                  nothing to retake here.
                </p>
                <Link href="/candidate/dashboard" className="state-action-btn">
                  Back to dashboard
                </Link>
              </div>
            )}

            {mode === "blocked" && (
              <div className="signin-state state-centered">
                <div className="state-icon-xl danger" aria-hidden>
                  <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
                    <circle cx="15" cy="15" r="11" stroke="currentColor" strokeWidth="2" />
                    <path d="m8 8 14 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <h2 className="state-title">This stage is closed</h2>
                <p className="state-subtitle">
                  After multiple attempts, the English assessment is no longer available on this
                  application. If you believe that&apos;s a mistake, our support team will take a look.
                </p>
                <a href="mailto:support@staffva.com" className="state-action-btn">
                  Contact support
                </a>
              </div>
            )}

            {mode === "cooldown" && (
              <div className="signin-state state-centered">
                <div className="state-icon-xl amber" aria-hidden>
                  <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
                    <circle cx="15" cy="15" r="11" stroke="currentColor" strokeWidth="2" />
                    <path d="M15 9v6l4 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h2 className="state-title">Your retake isn&apos;t open yet</h2>
                <p className="state-subtitle">
                  Use the time — the retake opens{" "}
                  <strong>
                    {retakeAvailableAt
                      ? new Date(retakeAvailableAt).toLocaleDateString("en-US", {
                          month: "long",
                          day: "numeric",
                        })
                      : "soon"}
                  </strong>
                  . Your dashboard has practice resources that target where your last attempt landed.
                </p>
                <Link href="/candidate/dashboard" className="state-action-btn">
                  Back to dashboard
                </Link>
              </div>
            )}

            {(mode === "run" || mode === "grade_retry") && stage === "consent" && (
              <div className="signin-state">
                <div className="consent-card-body">
                  <div className="consent-icon-wrap">
                    <div className="consent-icon recording" aria-hidden>
                      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                        <rect x="3" y="8" width="15" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
                        <path d="m18 12 6-3v10l-6-3" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      </svg>
                    </div>
                  </div>
                  <h2 className="consent-title">This assessment is recorded and proctored</h2>
                  <p className="consent-lead">
                    The session is proctored for the entire test — like a silent video-call
                    participant. Here&apos;s exactly what&apos;s captured.
                  </p>
                  <dl className="consent-block">
                    <dt>What&apos;s recorded</dt>
                    <dd>
                      Continuous <strong>video and audio</strong> from your camera and microphone,
                      your room scan, and browser signals like tab switches and fullscreen exits.
                      {spokenParts ? " Your spoken answers are recorded and transcribed for scoring." : ""}
                    </dd>
                    <dt>Why</dt>
                    <dd>
                      To keep the assessment fair — and to confirm the person testing is the same
                      person who applied.
                    </dd>
                    <dt>Who decides</dt>
                    <dd>
                      Automated checks can only <strong>flag</strong> a session. Any integrity
                      decision is made by a person at StaffVA after watching the footage.
                    </dd>
                    <dt>How long it&apos;s kept</dt>
                    <dd>
                      A clean session&apos;s recording is <strong>deleted right after review</strong>.
                      Flagged footage is kept until a decision is made, then purged within 7 days.
                    </dd>
                  </dl>
                  <div className="consent-check-row">
                    <label className="check-row" style={{ fontSize: "13px" }}>
                      <input
                        type="checkbox"
                        checked={consentChecked}
                        onChange={(e) => setConsentChecked(e.target.checked)}
                      />
                      <span className="check-box" aria-hidden></span>
                      <span>I consent to this assessment being recorded and proctored as described.</span>
                    </label>
                  </div>
                  {error && (
                    <div className="field-error-text" role="alert" style={{ display: "block", marginBottom: "12px" }}>
                      <span className="err-msg">{error}</span>
                    </div>
                  )}
                  <div className="consent-actions">
                    <button
                      type="button"
                      className={`btn-submit${busy ? " loading" : ""}`}
                      disabled={!consentChecked || busy}
                      onClick={handleConsent}
                    >
                      <span className="submit-label">Start pre-flight checks</span>
                      <span className="spinner" aria-hidden></span>
                    </button>
                    <button
                      type="button"
                      className="consent-decline"
                      onClick={() => router.push("/candidate/dashboard")}
                    >
                      Not now
                    </button>
                  </div>
                </div>
              </div>
            )}

            {mode === "run" && stage === "preflight" && (
              <div className="signin-state">
                <div style={{ textAlign: "center" }}>
                  <div className="camera-step-caption">Pre-flight · 1 of 3</div>
                  <h2 className="state-title" style={{ fontSize: "22px" }}>
                    Running system checks
                  </h2>
                  <p className="state-subtitle">
                    We&apos;re verifying your setup before the test begins. Allow camera and
                    microphone access when your browser asks.
                  </p>
                </div>
                <div className="preflight-webcam-preview" aria-hidden>
                  <video
                    ref={proctor.registerVideo}
                    autoPlay
                    muted
                    playsInline
                    style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
                  />
                </div>
                <ul className="preflight-checks" aria-live="polite">
                  {(
                    [
                      ["webcam", "Webcam working"],
                      ["mic", "Microphone working"],
                      ["connection", "Internet connection"],
                    ] as const
                  ).map(([key, label]) => (
                    <li
                      key={key}
                      className={`preflight-check${pfState[key] === "checking" ? " checking" : ""}${pfState[key] === "passed" ? " passed" : ""}`}
                      style={pfState[key] === "failed" ? { borderColor: "var(--danger)" } : undefined}
                    >
                      <span className="preflight-check-icon" aria-hidden></span>
                      <span
                        className="preflight-check-label"
                        style={pfState[key] === "failed" ? { color: "var(--danger)" } : undefined}
                      >
                        {pfState[key] === "failed" ? `${label} — failed` : label}
                      </span>
                      {key === "mic" && (
                        <div className="audio-meter" aria-hidden>
                          <span></span>
                          <span></span>
                          <span></span>
                          <span></span>
                          <span></span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="btn-submit"
                  style={{ marginTop: "22px" }}
                  disabled={!pfDone && !pfFailed}
                  onClick={() => (pfDone ? setStage("rules") : runPreflight())}
                >
                  <span className="submit-label">
                    {pfDone ? "Continue to rules" : pfFailed ? "Re-run checks" : "Running checks…"}
                  </span>
                </button>
              </div>
            )}

            {mode === "run" && stage === "camera_denied" && (
              <div className="signin-state state-centered">
                <div className="state-icon-xl amber" aria-hidden>
                  <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
                    <rect x="3" y="9" width="16" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
                    <path d="m19 13.5 7-3.5v11l-7-3.5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                    <path d="m5 5 20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <h2 className="state-title">Camera and microphone required</h2>
                <p className="state-subtitle">
                  The assessment is proctored and includes spoken answers, so we need both. Allow
                  access in your browser&apos;s permissions and try again — your progress isn&apos;t
                  lost.
                </p>
                <button type="button" className="state-action-btn" onClick={() => setStage("preflight")}>
                  Try again
                </button>
              </div>
            )}

            {mode === "run" && stage === "rules" && (
              <div className="signin-state">
                <div style={{ textAlign: "center" }}>
                  <div className="camera-step-caption">Pre-flight · 2 of 3</div>
                  <h2 className="state-title" style={{ fontSize: "22px" }}>
                    Review the test rules
                  </h2>
                  <p className="state-subtitle">
                    Please read through these. You&apos;ll acknowledge before we continue.
                  </p>
                </div>
                <div className="rules-scroll-wrap">
                  <ol className="rules-list">
                    <li>You must remain on camera the entire time.</li>
                    <li>Do not look off-screen repeatedly — occasional glances are fine.</li>
                    <li>Do not talk to anyone else during the test.</li>
                    <li>No other people may be visible or audible in the room.</li>
                    <li>No second screens, phones, or devices in view.</li>
                    <li>No notes, books, or reference materials.</li>
                    <li>Do not switch browser tabs or windows.</li>
                    <li>If you leave the camera frame, the session is flagged for review.</li>
                    <li>Violations may disqualify you from this stage.</li>
                    <li className="gentle">Be natural. Do your best. The session is proctored.</li>
                  </ol>
                </div>
                <label className="check-row" style={{ fontSize: "13px", marginTop: "14px" }}>
                  <input
                    type="checkbox"
                    checked={rulesChecked}
                    onChange={(e) => setRulesChecked(e.target.checked)}
                  />
                  <span className="check-box" aria-hidden></span>
                  <span>I&apos;ve read and understand the rules.</span>
                </label>
                {error && (
                  <div className="field-error-text" role="alert" style={{ display: "block", marginTop: "10px" }}>
                    <span className="err-msg">{error}</span>
                  </div>
                )}
                <button
                  type="button"
                  className={`btn-submit${busy ? " loading" : ""}`}
                  style={{ marginTop: "16px" }}
                  disabled={!rulesChecked || busy}
                  onClick={handleRules}
                >
                  <span className="submit-label">Continue to environment scan</span>
                  <span className="spinner" aria-hidden></span>
                </button>
              </div>
            )}

            {mode === "run" && stage === "scan" && (
              <div className="signin-state">
                <div style={{ textAlign: "center" }}>
                  <div className="camera-step-caption">Pre-flight · 3 of 3</div>
                  <h2 className="state-title" style={{ fontSize: "22px" }}>
                    Scan your environment
                  </h2>
                  <p className="state-subtitle">
                    Slowly turn your laptop or camera in a full circle so the whole room is on the
                    recording a reviewer can watch.
                  </p>
                </div>
                <div className="scan-stage" role="region" aria-label="360-degree environment scan">
                  <video
                    ref={proctor.registerVideo}
                    autoPlay
                    muted
                    playsInline
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
                  />
                  <div className="scan-compass" style={{ position: "relative" }}>
                    <span className="n">N</span>
                    <span className="e">E</span>
                    <span className="s">S</span>
                    <span className="w">W</span>
                  </div>
                  <div className="scan-ring" style={{ position: "relative" }}></div>
                  <div className="scan-instruction" style={{ position: "relative" }}>{scanText}</div>
                </div>
                <button
                  type="button"
                  className="btn-submit"
                  style={{ marginTop: "16px" }}
                  disabled={!scanDone}
                  onClick={() => setStage("start")}
                >
                  <span className="submit-label">{scanDone ? "Continue to start" : "Scanning…"}</span>
                </button>
              </div>
            )}

            {mode === "run" && stage === "start" && (
              <div className="signin-state state-centered">
                <div className="state-icon-xl" style={{ background: "var(--lime)", color: "var(--ink)" }} aria-hidden>
                  <svg width="30" height="30" viewBox="0 0 30 30" fill="currentColor">
                    <path d="M10 6.5v17c0 1.2 1.3 1.9 2.3 1.2l12.6-8.5a1.4 1.4 0 0 0 0-2.4L12.3 5.3c-1-.7-2.3 0-2.3 1.2Z" />
                  </svg>
                </div>
                <h2 className="state-title">You&apos;re ready</h2>
                <p className="state-subtitle">
                  All checks passed. The test covers {partsLine} on a {clockLabel} clock, and you
                  can&apos;t pause once you begin. Ready when you are.
                </p>
                {error && (
                  <div className="field-error-text" role="alert" style={{ display: "block", marginBottom: "12px" }}>
                    <span className="err-msg">{error}</span>
                  </div>
                )}
                <button
                  type="button"
                  className={`btn-submit${busy ? " loading" : ""}`}
                  disabled={busy}
                  onClick={handleStart}
                >
                  <span className="submit-label">Start the test</span>
                  <span className="spinner" aria-hidden></span>
                </button>
                <p className="state-fine-print">
                  Need more time? <Link href="/candidate/dashboard">Come back later</Link> — nothing
                  is counted against you until you start.
                </p>
              </div>
            )}

            {stage === "grading" && (
              <div className="signin-state">
                <div className="post-test-stage">
                  <div className="post-test-icon" aria-hidden>
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                      <path d="m8 17 6 6L25 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <h2 className="state-title">Proctored assessment submitted</h2>
                  <p className="state-subtitle">
                    We&apos;re scoring it now — usually under a minute. Don&apos;t close this window.
                  </p>
                  <div className="routing-pulse" style={{ marginTop: "24px" }} aria-hidden>
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}

            {stage === "grading_failed" && (
              <div className="signin-state state-centered">
                <div className="state-icon-xl amber" aria-hidden>
                  <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
                    <circle cx="15" cy="15" r="11" stroke="currentColor" strokeWidth="2" />
                    <path d="M15 9v6l4 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                {submitBlocked === "expired" ? (
                  <>
                    <h2 className="state-title">Time ran out on this attempt</h2>
                    <p className="state-subtitle">
                      The submission arrived after the attempt&apos;s deadline, so it can&apos;t be
                      scored. Head back to your dashboard to start a fresh attempt.
                    </p>
                    <Link href="/candidate/dashboard" className="state-action-btn">
                      Back to dashboard
                    </Link>
                  </>
                ) : submitBlocked === "network" ? (
                  <>
                    <h2 className="state-title">Your submission didn&apos;t reach us</h2>
                    <p className="state-subtitle">
                      Your answers are still in this browser tab — <strong>don&apos;t close it</strong>.
                      Check your connection and resubmit.
                    </p>
                    {error && (
                      <div className="field-error-text" role="alert" style={{ display: "block", marginBottom: "12px" }}>
                        <span className="err-msg">{error}</span>
                      </div>
                    )}
                    <button type="button" className="state-action-btn" disabled={busy} onClick={retryGrading}>
                      {busy ? "Submitting…" : "Resubmit my answers"}
                    </button>
                  </>
                ) : (
                  <>
                    <h2 className="state-title">Your answers are in — scoring hit a snag</h2>
                    <p className="state-subtitle">
                      Everything you submitted is saved on our side; nothing needs redoing. Scoring
                      doesn&apos;t restart on its own — retry it below, or come back to this page
                      later and it will offer the retry again.
                    </p>
                    {error && (
                      <div className="field-error-text" role="alert" style={{ display: "block", marginBottom: "12px" }}>
                        <span className="err-msg">{error}</span>
                      </div>
                    )}
                    <button type="button" className="state-action-btn" disabled={busy} onClick={retryGrading}>
                      {busy ? "Scoring…" : "Try scoring again"}
                    </button>
                    <p className="state-fine-print">
                      <Link href="/candidate/dashboard">Back to dashboard</Link>
                    </p>
                  </>
                )}
              </div>
            )}

            {stage === "done_pass" && (
              <div className="signin-state state-centered">
                <Asti variant="celebrate" size={96} />
                <h2 className="state-title">You passed, nicely done</h2>
                <AstiPointChip label="+100 · English assessment" />
                <p className="state-subtitle">Taking you to your dashboard for your next step…</p>
                <div className="routing-pulse" aria-hidden>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            )}

            {stage === "done_fail" && (
              <div className="signin-state state-centered">
                <div className="state-icon-xl amber" aria-hidden>
                  <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
                    <circle cx="15" cy="15" r="11" stroke="currentColor" strokeWidth="2" />
                    <path d="M15 9v6l4 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                {resultInfo.blocked ? (
                  <>
                    <h2 className="state-title">This stage has closed</h2>
                    <p className="state-subtitle">
                      After multiple attempts, the English assessment is no longer available on
                      this application. If you believe that&apos;s a mistake,{" "}
                      <a href="mailto:support@staffva.com">support@staffva.com</a> will take a
                      look. Taking you to your dashboard…
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="state-title">Not this time — but it&apos;s not over</h2>
                    <p className="state-subtitle">
                      Your score breakdown{resultInfo.retakeAt ? " and retake date are" : " is"} on
                      your dashboard, with practice resources. Taking you there…
                    </p>
                  </>
                )}
                <div className="routing-pulse" aria-hidden>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
