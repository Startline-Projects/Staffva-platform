"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  validateAudio,
} from "@/lib/audioUtils";

const ORAL_PASSAGE = `Thank you for taking the time to meet with me today. I wanted to follow up on the invoices we discussed last week. Three of them are still showing as unpaid in our system, and the due dates have already passed. I have attached the updated statements to this email for your reference. Please let me know if there is anything missing or if you need me to resend any of the original documents. I am available this week if you would like to schedule a call to go over the details together.`;

const MAX_RECORDING_TIME = 90;
const MIN_RECORDING_SECONDS = 15;

interface Props {
  candidateId: string;
  onComplete: (url: string) => void;
}

export default function VoiceRecording1({ candidateId, onComplete }: Props) {
  const [phase, setPhase] = useState<"ready" | "recording" | "uploading">("ready");
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordedBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      mediaRecorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startRecording() {
    setError("");
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
      setError("Microphone access denied. Please allow microphone access and try again.");
    }
  }

  async function handleRecordingComplete() {
    setError("");
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    recordedBlobRef.current = blob;

    const validation = await validateAudio(blob, MIN_RECORDING_SECONDS);
    if (!validation.valid) {
      setError(validation.error || "Recording validation failed.");
      setPhase("ready");
      return;
    }

    await autoUpload(blob);
  }

  async function autoUpload(blob: Blob) {
    setPhase("uploading");
    setUploadProgress("Uploading recording...");

    try {
      const supabase = createClient();
      const timestamp = Date.now();
      const fullFileName = `${candidateId}/oral-reading-${timestamp}.webm`;

      const { error: uploadError } = await supabase.storage
        .from("voice-recordings")
        .upload(fullFileName, blob);

      if (uploadError) {
        setError("Failed to upload recording: " + uploadError.message);
        setPhase("ready");
        return;
      }

      setUploadProgress("Saving...");
      await supabase
        .from("candidates")
        .update({ voice_recording_1_url: fullFileName })
        .eq("id", candidateId);

      onComplete(fullFileName);
    } catch {
      setError("Upload failed. Please try again.");
      setPhase("ready");
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
  }

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-[#1C1B1A]">
        Oral Reading Assessment
      </h1>

      {phase === "ready" && (
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-500 leading-relaxed">
            When you are ready to begin, click <strong>Start Recording</strong>. The passage will appear and your recording will start at the same time.
          </p>

          <button
            onClick={startRecording}
            className="mt-8 w-full rounded-full bg-[#FE6E3E] px-4 py-3.5 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors"
          >
            Start Recording
          </button>

          <p className="mt-4 text-xs text-gray-400">
            Minimum 15 seconds, maximum 90 seconds. Read clearly at a natural pace.
          </p>
        </div>
      )}

      {phase === "recording" && (
        <div className="mt-8 text-center">
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-red-100">
            <div className="h-4 w-4 animate-pulse rounded-full bg-red-600" />
          </div>
          <p className="mt-4 text-lg font-semibold text-[#1C1B1A]">
            Recording... {formatTime(recordingTime)} / {formatTime(MAX_RECORDING_TIME)}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Read the passage clearly at a natural pace.
          </p>
          <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-6">
            <p className="text-sm leading-relaxed text-gray-700">{ORAL_PASSAGE}</p>
          </div>
          {recordingTime >= MIN_RECORDING_SECONDS && (
            <button
              onClick={stopRecording}
              className="mt-6 rounded-lg border border-gray-300 px-6 py-2.5 text-sm font-medium text-[#1C1B1A] hover:bg-gray-50 transition-colors"
            >
              Stop Recording
            </button>
          )}
          {recordingTime < MIN_RECORDING_SECONDS && (
            <p className="mt-4 text-xs text-gray-400">
              Minimum {MIN_RECORDING_SECONDS} seconds required ({MIN_RECORDING_SECONDS - recordingTime}s remaining)
            </p>
          )}
        </div>
      )}

      {phase === "uploading" && (
        <div className="mt-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" />
          </div>
          <p className="mt-4 text-sm text-gray-500">{uploadProgress}</p>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
    </div>
  );
}
