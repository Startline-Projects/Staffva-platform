"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  validateAudio,
  createPlaybackUrl,
  revokePlaybackUrl,
} from "@/lib/audioUtils";

const MAX_RECORDING_TIME = 90;
const MIN_RECORDING_SECONDS = 15;

const DISCUSSION_POINTS = [
  { num: 1, text: "Your **first name only** and the country you are based in" },
  { num: 2, text: "The type of role you are applying for and how many years of experience you have" },
  { num: 3, text: "One specific example of a task or project you handled professionally" },
  { num: 4, text: "Your availability and what you are looking for in a working relationship" },
];

interface Props {
  candidateId: string;
  onComplete: (url: string) => void;
}

// Module scope, not inside the component. Declared during render it became a new
// component type on every render, so React remounted it instead of updating it —
// and this card is on screen while a per-second recording timer ticks, so the
// text the candidate is reading was being torn down and rebuilt once a second.
// It closes over nothing: DISCUSSION_POINTS is a module constant.
function DiscussionPointsCard() {
  return (
    <div className="mt-6 text-left">
      <span className="feedback-block-label">Cover these points:</span>
      {/* .rules-list numbers each item from a CSS counter, so the point number
          is still shown — it is no longer a hand-rendered span. */}
      <ol className="rules-list">
        {DISCUSSION_POINTS.map((point) => (
          <li
            key={point.num}
            dangerouslySetInnerHTML={{
              __html: point.text
                .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"),
            }}
          />
        ))}
      </ol>
    </div>
  );
}

export default function VoiceRecording2({ candidateId, onComplete }: Props) {
  const [phase, setPhase] = useState<
    "instructions" | "recording" | "review" | "uploading"
  >("instructions");
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState("");
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordedBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
      if (playbackUrl) revokePlaybackUrl(playbackUrl);
    };
  }, [playbackUrl]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
        audioBitsPerSecond: 128000,
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        handleRecordingComplete();
      };

      mediaRecorder.start();
      setPhase("recording");
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          if (prev >= MAX_RECORDING_TIME - 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            mediaRecorderRef.current?.stop();
            return MAX_RECORDING_TIME;
          }
          return prev + 1;
        });
      }, 1000);
    } catch {
      setError(
        "Microphone access denied. Please allow microphone access and try again."
      );
    }
  }

  async function handleRecordingComplete() {
    setError("");
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    recordedBlobRef.current = blob;

    // Validate
    const validation = await validateAudio(blob, MIN_RECORDING_SECONDS);
    if (!validation.valid) {
      setError(validation.error || "Recording validation failed.");
      setPhase("instructions");
      return;
    }

    // Create playback URL for review
    const url = createPlaybackUrl(blob);
    setPlaybackUrl(url);
    setPhase("review");
  }

  async function confirmAndUpload() {
    if (!recordedBlobRef.current) return;
    setPhase("uploading");
    setError("");

    try {
      setUploadProgress("Uploading recording...");
      const supabase = createClient();
      const timestamp = Date.now();
      const fullFileName = `${candidateId}/self-intro-${timestamp}.webm`;

      // Upload raw recording directly — no compression or preview generation
      const { error: uploadError } = await supabase.storage
        .from("voice-recordings")
        .upload(fullFileName, recordedBlobRef.current);

      if (uploadError) {
        setError("Failed to upload recording: " + uploadError.message);
        setPhase("review");
        return;
      }

      // Update candidate record
      setUploadProgress("Saving...");
      await supabase
        .from("candidates")
        .update({
          voice_recording_2_url: fullFileName,
        })
        .eq("id", candidateId);

      // Clean up playback URL
      if (playbackUrl) revokePlaybackUrl(playbackUrl);
      setPlaybackUrl(null);

      onComplete(fullFileName);
    } catch {
      setError("Upload failed. Please try again.");
      setPhase("review");
    }
  }

  function retryRecording() {
    if (playbackUrl) revokePlaybackUrl(playbackUrl);
    setPlaybackUrl(null);
    recordedBlobRef.current = null;
    setError("");
    setPhase("instructions");
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
  }

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="form-card">
        <div className="form-card-header">
          <h1 className="state-title">Self Introduction</h1>
          <span className="step-tag">Recording 2 of 2</span>
        </div>

        {phase === "instructions" && (
          <>
            <p className="state-subtitle">
              Record a 15 to 90 second introduction. Cover all four of the
              following points in order:
            </p>
            {/* .rules-list numbers each item from a CSS counter, so the point
                number is still shown — it is no longer a hand-rendered span. */}
            <ol className="rules-list">
              {DISCUSSION_POINTS.map((point) => (
                <li
                  key={point.num}
                  dangerouslySetInnerHTML={{
                    __html: point.text.replace(
                      /\*\*(.*?)\*\*/g,
                      "<strong>$1</strong>"
                    ),
                  }}
                />
              ))}
            </ol>
            <div className="trust-strip mt-5">
              <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <p>
                <strong>Important:</strong> Only mention your <strong>first name</strong> — do not share your last name.
              </p>
            </div>
            <p className="field-hint-inline">
              You can listen to your recording and re-record before submitting. This recording may be shared with prospective clients.
            </p>
            <button onClick={startRecording} className="btn-submit mt-6">
              <span className="submit-label">Start Recording</span>
              <svg className="arrow" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                <path d="M3.75 9h10.5M9.75 4.5 14.25 9l-4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        )}

        {phase === "recording" && (
          <div className="state-centered">
            {/* The Atlas record affordance: the pulsing ring is the state, not a
                control — the only control is the Stop button below, and it stays
                gated on MIN_RECORDING_SECONDS exactly as before. */}
            <div className="mic-record-area on-paper">
              <div className="mic-record-btn recording" aria-hidden>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
                  <rect x="9" y="9" width="10" height="10" rx="2" fill="currentColor" />
                </svg>
              </div>
              <div className="mic-waveform" aria-hidden>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>

            <div className="countdown-display">
              <span className="countdown-time">{formatTime(recordingTime)}</span>
              <span className="countdown-label">
                Recording · Max {formatTime(MAX_RECORDING_TIME)}
              </span>
            </div>

            <p className="state-subtitle">
              Speak clearly and cover all four points.
            </p>
            <DiscussionPointsCard />
            {recordingTime >= MIN_RECORDING_SECONDS && (
              <button onClick={stopRecording} className="state-action-btn mt-6">
                Stop Recording
              </button>
            )}
            {recordingTime < MIN_RECORDING_SECONDS && (
              <p className="attempts-hint">
                Minimum {MIN_RECORDING_SECONDS} seconds required (
                {MIN_RECORDING_SECONDS - recordingTime}s remaining)
              </p>
            )}
          </div>
        )}

        {phase === "review" && playbackUrl && (
          <div className="state-centered">
            <div className="state-icon-xl success">
              <svg
                width="28"
                height="28"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"
                />
              </svg>
            </div>
            <h2 className="state-title">Review Your Introduction</h2>
            <p className="state-subtitle">
              Listen to your recording and confirm it is clear before
              submitting.
            </p>

            <div className="mt-4">
              <audio
                controls
                src={playbackUrl}
                className="mx-auto w-full max-w-md"
              />
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button onClick={retryRecording} className="state-action-btn">
                Re-record
              </button>
              <div className="w-[240px]">
                <button onClick={confirmAndUpload} className="btn-submit">
                  <span className="submit-label">Confirm &amp; Submit</span>
                  <svg className="arrow" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                    <path d="M3.75 9h10.5M9.75 4.5 14.25 9l-4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {phase === "uploading" && (
          <div className="rec-submitting state-centered">
            <div className="spinner" />
            <p className="state-subtitle">{uploadProgress}</p>
          </div>
        )}

        {error && (
          <div className="form-alert visible mt-6">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <circle cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M9 5.25v4.5M9 12.375v.375" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div>{error}</div>
          </div>
        )}
      </div>
    </div>
  );
}
