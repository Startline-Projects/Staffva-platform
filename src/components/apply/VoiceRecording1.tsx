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

    const {
      data: { publicUrl },
    } = supabase.storage.from("voice-recordings").getPublicUrl(fileName);

    await supabase
      .from("candidates")
      .update({ voice_recording_1_url: publicUrl })
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
        Voice Recording 1: Oral Reading
      </h1>

      {phase === "instructions" && (
        <>
          <div className="mt-6 rounded-lg border border-gray-200 bg-card p-6">
            <p className="text-sm text-text/80">
              Read the following passage out loud clearly and at a natural pace.
              You have 30 seconds to read it silently before your recording
              begins automatically. You have one take — there is no re-record
              option. Take a breath and speak clearly.
            </p>
          </div>
          <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-6">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text/40">
              Passage to Read Aloud
            </h3>
            <p className="text-sm leading-relaxed text-text/80">
              {ORAL_PASSAGE}
            </p>
          </div>
          <button
            onClick={startSilentRead}
            className="mt-6 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
          >
            Start 30-Second Silent Read
          </button>
        </>
      )}

      {phase === "silent_read" && (
        <div className="mt-8 text-center">
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-primary/10">
            <span className="text-3xl font-bold text-primary">{countdown}</span>
          </div>
          <p className="mt-4 text-sm text-text/60">
            Read the passage silently. Recording starts automatically.
          </p>
          <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-6">
            <p className="text-sm leading-relaxed text-text/80">
              {ORAL_PASSAGE}
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
