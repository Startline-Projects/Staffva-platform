"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The proctor-session protocol, ported from components/proctor/ProctorGate
 * so the Atlas assessment page can run the SAME server contract (consent →
 * session → 10s chunks + 12s frames → end exactly once) under its own UI.
 * One difference, deliberate: the stream is captured WITH audio — the new
 * assessment has spoken parts, and a proctor recording that can hear a
 * second voice in the room is worth having. The consent copy says so.
 *
 * The gate's rule stands: this records and uploads; it never judges.
 */

const FRAME_INTERVAL_MS = 12_000;
const CHUNK_MS = 10_000;

export function useProctorSession() {
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const attemptIdRef = useRef<string | null>(null);
  const chunkNRef = useRef(0);
  const frameNRef = useRef(0);
  const cameraLostCountRef = useRef(0);
  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endedRef = useRef(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [cameraLost, setCameraLost] = useState(false);
  // Video elements register themselves; the stream attaches whenever both
  // sides exist (the mount-order lesson from ProctorGate, kept).
  const videoElsRef = useRef<Set<HTMLVideoElement>>(new Set());

  const attachToEls = useCallback(() => {
    if (!streamRef.current) return;
    for (const el of videoElsRef.current) {
      if (el.srcObject !== streamRef.current) el.srcObject = streamRef.current;
    }
  }, []);

  const registerVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      if (!el) return;
      videoElsRef.current.add(el);
      attachToEls();
    },
    [attachToEls]
  );

  /** Acquire camera + mic once. Returns true on success. */
  const acquire = useCallback(async (): Promise<boolean> => {
    if (streamRef.current) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
        audio: true,
      });
      streamRef.current = stream;
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          cameraLostCountRef.current++;
          setCameraLost(true);
        };
      });
      // Level meter for the preflight mic check.
      try {
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
      } catch {
        /* meter is a nicety; the mic check falls back to track state */
      }
      attachToEls();
      return true;
    } catch {
      return false;
    }
  }, [attachToEls]);

  const audioLevel = useCallback((): number => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (const v of data) sum += v;
    return sum / data.length / 255;
  }, []);

  const hasTracks = useCallback(
    () => ({
      video: !!streamRef.current?.getVideoTracks().some((t) => t.readyState === "live"),
      audio: !!streamRef.current?.getAudioTracks().some((t) => t.readyState === "live"),
    }),
    []
  );

  const upload = useCallback(async (kind: "chunk" | "frame", n: number, blob: Blob) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const send = () =>
      fetch(`/api/proctor/session/${sid}/upload?kind=${kind}&n=${n}`, {
        method: "POST",
        body: blob,
      });
    try {
      const res = await send();
      if (!res.ok && res.status >= 500) await send();
    } catch {
      try {
        await send();
      } catch {
        /* dropped; gaps make the review suspicious, never invisible */
      }
    }
  }, []);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
        ? "video/webm;codecs=vp8"
        : "video/webm",
      videoBitsPerSecond: 400_000,
    });
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) upload("chunk", chunkNRef.current++, e.data);
    };
    recorder.start(CHUNK_MS);
    recorderRef.current = recorder;

    if (frameTimerRef.current) clearInterval(frameTimerRef.current);
    frameTimerRef.current = setInterval(() => {
      const video = [...videoElsRef.current].find((el) => el.videoWidth > 0);
      if (!video) return;
      const canvas = document.createElement("canvas");
      const w = 512;
      canvas.width = w;
      canvas.height = Math.round((video.videoHeight / video.videoWidth) * w);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (blob) upload("frame", frameNRef.current++, blob);
        },
        "image/jpeg",
        0.6
      );
    }, FRAME_INTERVAL_MS);
  }, [upload]);

  /** Record proctor consent (versioned, server-side). */
  const recordConsent = useCallback(async (): Promise<boolean> => {
    const res = await fetch("/api/proctor/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "2.0" }),
    });
    return res.ok;
  }, []);

  /** Open the server session and start capture. */
  const startSession = useCallback(async (): Promise<boolean> => {
    if (!streamRef.current) return false;
    const res = await fetch("/api/proctor/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKind: "english_test" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.sessionId) return false;
    sessionIdRef.current = data.sessionId;
    startRecording();
    return true;
  }, [startRecording]);

  const linkAttempt = useCallback((attemptId: string) => {
    attemptIdRef.current = attemptId;
  }, []);

  /** A separate audio-only recorder over the shared mic track, for spoken
   * answers. Returns a stopper that resolves with the recorded blob. */
  const recordAnswer = useCallback((): { stop: () => Promise<Blob> } | null => {
    const audioTrack = streamRef.current?.getAudioTracks().find((t) => t.readyState === "live");
    if (!audioTrack) return null;
    const answerStream = new MediaStream([audioTrack]);
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(answerStream, {
      mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm",
    });
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    rec.start();
    return {
      stop: () =>
        new Promise<Blob>((resolve) => {
          rec.onstop = () => resolve(new Blob(chunks, { type: "audio/webm" }));
          try {
            rec.stop();
          } catch {
            resolve(new Blob(chunks, { type: "audio/webm" }));
          }
        }),
    };
  }, []);

  const reconnectCamera = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
        audio: true,
      });
      try {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          recorderRef.current.stop();
        }
      } catch {
        /* replaced below */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          cameraLostCountRef.current++;
          setCameraLost(true);
        };
      });
      attachToEls();
      if (sessionIdRef.current) startRecording();
      setCameraLost(false);
      return true;
    } catch {
      return false;
    }
  }, [attachToEls, startRecording]);

  const endSession = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    } catch {
      /* already stopped */
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (frameTimerRef.current) clearInterval(frameTimerRef.current);
    try {
      audioCtxRef.current?.close();
    } catch {
      /* fine */
    }
    const sid = sessionIdRef.current;
    if (sid) {
      fetch(`/api/proctor/session/${sid}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attemptId: attemptIdRef.current || undefined,
          cameraLostCount: cameraLostCountRef.current,
        }),
        keepalive: true,
      }).catch(() => {});
    }
  }, []);

  // End exactly once — unmount or page close.
  useEffect(() => {
    window.addEventListener("pagehide", endSession);
    return () => {
      window.removeEventListener("pagehide", endSession);
      endSession();
    };
  }, [endSession]);

  return {
    acquire,
    audioLevel,
    hasTracks,
    recordConsent,
    startSession,
    linkAttempt,
    recordAnswer,
    registerVideo,
    reconnectCamera,
    endSession,
    cameraLost,
  };
}
