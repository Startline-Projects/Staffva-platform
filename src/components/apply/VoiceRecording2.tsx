"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

const PREP_TIME = 30;
const MAX_RECORDING_TIME = 90;

interface Props {
  candidateId: string;
  onComplete: (url: string) => void;
}

export default function VoiceRecording2({ candidateId, onComplete }: Props) {
  const [phase, setPhase] = useState<"instructions" | "prep" | "recording" | "uploading">("instructions");
  const [countdown, setCountdown] = useState(PREP_TIME);
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

  function startPrep() {
    setPhase("prep");
    setCountdown(PREP_TIME);

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
    const fileName = `${candidateId}/self-intro-${Date.now()}.webm`;

    const supabase = createClient();

    const { error: uploadError } = await supabase.storage
      .from("voice-recordings")
      .upload(fileName, blob);

    if (uploadError) {
      setError("Failed to upload recording: " + uploadError.message);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("voice-recordings").getPublicUrl(fileName);

    await supabase
      .from("candidates")
      .update({ voice_recording_2_url: publicUrl })
      .eq("id", candidateId);

    onComplete(publicUrl);
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
        Voice Recording 2: Self Introduction
      </h1>

      {phase === "instructions" && (
        <>
          <div className="mt-6 rounded-lg border border-gray-200 bg-card p-6">
            <p className="text-sm text-text/80">
              Record a 60 to 90 second introduction. Cover all four of the
              following points in order:
            </p>
            <ol className="mt-4 space-y-2 text-sm text-text/80">
              <li className="flex gap-2">
                <span className="font-semibold text-primary">1.</span>
                Your name and the country you are based in
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-primary">2.</span>
                The type of role you are applying for and how many years of
                experience you have
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-primary">3.</span>
                One specific example of a task or project you handled
                professionally
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-primary">4.</span>
                Your availability and what you are looking for in a working
                relationship
              </li>
            </ol>
            <p className="mt-4 text-sm text-text/80">
              You have 30 seconds to prepare. Your recording will begin
              automatically. You have one take — speak naturally and clearly.
            </p>
          </div>
          <button
            onClick={startPrep}
            className="mt-6 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
          >
            Start 30-Second Preparation
          </button>
        </>
      )}

      {phase === "prep" && (
        <div className="mt-8 text-center">
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-primary/10">
            <span className="text-3xl font-bold text-primary">{countdown}</span>
          </div>
          <p className="mt-4 text-sm text-text/60">
            Prepare your introduction. Recording starts automatically.
          </p>
          <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-6 text-left">
            <p className="text-xs font-semibold uppercase tracking-wider text-text/40 mb-3">
              Remember to cover:
            </p>
            <ol className="space-y-1 text-sm text-text/60">
              <li>1. Name and country</li>
              <li>2. Role and experience</li>
              <li>3. Specific professional example</li>
              <li>4. Availability and goals</li>
            </ol>
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
            Speak clearly and cover all four points.
          </p>
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
