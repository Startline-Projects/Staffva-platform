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
  const [phase, setPhase] = useState<"ready" | "recording">("ready");
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
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

    // Upload FIRST, advance second.
    //
    // This used to call onComplete() and then start a background upload. Three
    // things went wrong together when that upload failed: the candidate record
    // already pointed at a file that did not exist; the parent had unmounted
    // this component, so the terminal setError was a no-op nobody ever saw; and
    // the recording is one of the ten approval gates, so the candidate walked
    // on with a gate satisfied by a URL resolving to nothing.
    //
    // All 109 stored recordings currently have their file, so it has not bitten
    // at n=56 on good connections. It would at the agreed 2,200.
    const timestamp = Date.now();
    const fullFileName = `${candidateId}/oral-reading-${timestamp}.webm`;

    setUploading(true);
    const uploadError = await uploadWithRetries(blob, fullFileName, 3);
    setUploading(false);

    if (uploadError) {
      setError("We couldn't save your recording. Check your connection and record it again.");
      setPhase("ready");
      return;
    }

    onComplete(fullFileName);
  }

  /** Returns an error message, or null on success. Never advances anything. */
  async function uploadWithRetries(
    blob: Blob,
    fileName: string,
    attempts: number
  ): Promise<string | null> {
    const supabase = createClient();
    for (let i = 0; i < attempts; i++) {
      try {
        const { error: uploadError } = await supabase.storage
          .from("voice-recordings")
          // upsert so a retry after a partial write cannot collide with itself.
          .upload(fileName, blob, { upsert: true });
        if (uploadError) throw uploadError;

        const { error: updateError } = await supabase
          .from("candidates")
          .update({ voice_recording_1_url: fileName })
          .eq("id", candidateId);
        if (updateError) throw updateError;

        return null;
      } catch (err) {
        if (i === attempts - 1) {
          console.error("Voice upload failed after retries:", err);
          return err instanceof Error ? err.message : "upload failed";
        }
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    return "upload failed";
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

      {/* The upload blocks the advance, so the candidate has to be told it is
          happening — but only once recording has actually stopped. Rendered
          unconditionally it sat next to a live "Recording…" and a working Stop
          button, which reads as two contradictory things at once. */}
      {uploading && phase !== "recording" && (
        <p className="mt-4 text-center text-sm text-text/60">
          Saving your recording…
        </p>
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

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
    </div>
  );
}
