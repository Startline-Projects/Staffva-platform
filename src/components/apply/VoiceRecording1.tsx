"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

const ORAL_PASSAGE = `Thank you for taking the time to meet with me today. I wanted to follow up on the invoices we discussed last week. Three of them are still showing as unpaid in our system, and the due dates have already passed. I have attached the updated statements to this email for your reference. Please let me know if there is anything missing or if you need me to resend any of the original documents. I am available this week if you would like to schedule a call to go over the details together.`;

const SILENT_READ_TIME = 30;
const MAX_RECORDING_TIME = 90;

interface Props {
  candidateId: string;
  onComplete: (url: string) => void;
}

export default function VoiceRecording1({ candidateId, onComplete }: Props) {
  const [phase, setPhase] = useState<"instructions" | "silent_read" | "recording" | "uploading">("instructions");
  const [countdown, setCountdown] = useState(SILENT_READ_TIME);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function startSilentRead() {
    setPhase("silent_read");
    setCountdown(SILENT_READ_TIME);

    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          startRecording();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        uploadRecording();
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

  async function uploadRecording() {
    setPhase("uploading");

    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    const fileName = `${candidateId}/oral-reading-${Date.now()}.webm`;

    const supabase = createClient();

    const { error: uploadError } = await supabase.storage
      .from("voice-recordings")
      .upload(fileName, blob);

    if (uploadError) {
      setError("Failed to upload recording: " + uploadError.message);
      return;
    }

    // Store the file path (not a full URL) so we can generate signed URLs later
    const storagePath = fileName;

    await supabase
      .from("candidates")
      .update({ voice_recording_1_url: storagePath })
      .eq("id", candidateId);

    onComplete(storagePath);
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
  }

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-text">
        Voice Recording 1: Oral Reading
      </h1>

      {phase === "instructions" && (
        <>
          <div className="mt-6 rounded-lg border border-gray-200 bg-card p-6">
            <p className="text-sm text-text/80">
              You will be shown a passage to read out loud clearly and at a natural pace.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-text/70">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">1</span>
                Click the button below to start a <strong>30-second countdown</strong>.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">2</span>
                After 30 seconds, the passage will appear and your <strong>microphone will activate automatically</strong>.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">3</span>
                Read the passage out loud. You have <strong>90 seconds maximum</strong>. There is no re-record option.
              </li>
            </ul>
          </div>
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-800 flex items-center gap-2">
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              The passage is hidden until recording starts. A 30-second countdown begins when you click Start.
            </p>
          </div>
          <button
            onClick={startSilentRead}
            className="mt-6 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
          >
            Start 30-Second Countdown
          </button>
        </>
      )}

      {phase === "silent_read" && (
        <div className="mt-8 text-center">
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-primary/10">
            <span className="text-3xl font-bold text-primary">{countdown}</span>
          </div>
          <p className="mt-4 text-lg font-semibold text-text">Preparing your recording...</p>
          <p className="mt-2 text-sm text-text/60">
            Your microphone will activate in {countdown} seconds. The passage will appear when recording begins.
          </p>
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-800">
              Get ready — the passage will appear and recording will start automatically. Read it out loud clearly at a natural pace.
            </p>
          </div>
        </div>
      )}

      {phase === "recording" && (
        <div className="mt-8 text-center">
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-red-100">
            <div className="h-4 w-4 animate-pulse rounded-full bg-red-600" />
          </div>
          <p className="mt-4 text-lg font-semibold text-text">
            Recording... {formatTime(recordingTime)} / {formatTime(MAX_RECORDING_TIME)}
          </p>
          <p className="mt-1 text-sm text-text/60">
            Read the passage clearly at a natural pace.
          </p>
          <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-6">
            <p className="text-sm leading-relaxed text-text/80">
              {ORAL_PASSAGE}
            </p>
          </div>
          {recordingTime >= 10 && (
            <button
              onClick={stopRecording}
              className="mt-6 rounded-lg border border-gray-300 px-6 py-2.5 text-sm font-medium text-text hover:bg-gray-50 transition-colors"
            >
              Stop Recording
            </button>
          )}
        </div>
      )}

      {phase === "uploading" && (
        <div className="mt-8 text-center">
          <p className="text-text/60">Uploading your recording...</p>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </div>
  );
}
