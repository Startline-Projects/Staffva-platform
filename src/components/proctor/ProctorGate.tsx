"use client";

import { useEffect, useRef, useState } from "react";
import { registerProctorListener } from "@/lib/proctorBridge";
import { PROCTOR_CONSENT_VERSION } from "@/lib/proctorConsent";

/**
 * The proctored-session gate. Wraps an assessment and enforces, in order:
 * versioned consent (the affirmative act is recorded server-side with a
 * timestamp), a working camera (hard requirement — no camera, no test),
 * then continuous capture while the assessment runs: 10-second video
 * chunks plus a review frame every 12 seconds, uploaded as they happen,
 * with a visible "Proctored session" indicator the whole time.
 *
 * The gate never judges anything. Review happens after the session, by the
 * AI reviewer and — only for flagged sessions — a person. Clean sessions'
 * recordings are deleted; that promise lives in the consent copy below and
 * the review pipeline keeps it.
 */

interface Props {
  sessionKind: "english_test";
  children: React.ReactNode;
}

const FRAME_INTERVAL_MS = 12_000;
const CHUNK_MS = 10_000;

export default function ProctorGate({ sessionKind, children }: Props) {
  const [phase, setPhase] = useState<"consent" | "camera" | "live" | "blocked">("consent");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cameraLost, setCameraLost] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const attemptIdRef = useRef<string | null>(null);
  const chunkNRef = useRef(0);
  const frameNRef = useRef(0);
  const cameraLostCountRef = useRef(0);
  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endedRef = useRef(false);
  const previewRef = useRef<HTMLVideoElement>(null);
  const thumbRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    return registerProctorListener({
      linkAttempt: (id) => {
        attemptIdRef.current = id;
      },
    });
  }, []);

  // (Re)wire the stream to whatever video elements this phase just
  // mounted. Assigning srcObject before the element exists left the
  // camera-check preview black and — worse — the live thumbnail the
  // frame-grabber reads from, so zero review frames ever uploaded and
  // every clean session flagged as "no footage".
  useEffect(() => {
    if (!streamRef.current) return;
    if (previewRef.current && previewRef.current.srcObject !== streamRef.current) {
      previewRef.current.srcObject = streamRef.current;
    }
    if (thumbRef.current && thumbRef.current.srcObject !== streamRef.current) {
      thumbRef.current.srcObject = streamRef.current;
    }
  }, [phase]);

  // End the session exactly once — on unmount (test submitted, step moved
  // on) or on page close.
  useEffect(() => {
    function endSession() {
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
    }
    window.addEventListener("pagehide", endSession);
    return () => {
      window.removeEventListener("pagehide", endSession);
      endSession();
    };
  }, []);

  async function upload(kind: "chunk" | "frame", n: number, blob: Blob) {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const send = () =>
      fetch(`/api/proctor/session/${sid}/upload?kind=${kind}&n=${n}`, {
        method: "POST",
        body: blob,
      });
    try {
      const res = await send();
      if (!res.ok && res.status >= 500) await send(); // one retry, same n (upsert)
    } catch {
      try {
        await send();
      } catch {
        /* dropped; gaps make the review suspicious, never invisible */
      }
    }
  }

  function attachStream(stream: MediaStream) {
    streamRef.current = stream;
    if (previewRef.current) previewRef.current.srcObject = stream;
    if (thumbRef.current) thumbRef.current.srcObject = stream;

    stream.getVideoTracks().forEach((track) => {
      track.onended = () => {
        cameraLostCountRef.current++;
        setCameraLost(true);
      };
    });

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
      const video = thumbRef.current;
      if (!video || video.videoWidth === 0) return;
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
  }

  async function requestCamera() {
    setBusy(true);
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
        audio: false,
      });
      streamRef.current = stream;
      if (previewRef.current) previewRef.current.srcObject = stream;
      setBusy(false);
      setPhase("camera");
    } catch {
      setBusy(false);
      setPhase("blocked");
    }
  }

  async function agreeAndContinue() {
    if (!agreed || busy) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/proctor/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: PROCTOR_CONSENT_VERSION }),
    });
    if (!res.ok) {
      setBusy(false);
      setError("Couldn't record your consent — try again.");
      return;
    }
    setBusy(false);
    await requestCamera();
  }

  async function startSession() {
    if (busy || !streamRef.current) return;
    setBusy(true);
    setError("");
    // Fullscreen was entered at the instructions screen, but the camera
    // permission prompt kicks the page out of it — re-enter here, inside
    // this click's gesture, so the test starts fullscreen as it always did.
    document.documentElement.requestFullscreen?.().catch(() => {
      /* unsupported or denied — the test tolerates windowed mode */
    });
    const res = await fetch("/api/proctor/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKind }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !data.sessionId) {
      setError(data.error || "Couldn't start the proctored session — try again.");
      return;
    }
    sessionIdRef.current = data.sessionId;
    attachStream(streamRef.current);
    setPhase("live");
  }

  async function reconnectCamera() {
    if (busy) return;
    setBusy(true);
    // The re-permission prompt may have dropped fullscreen too.
    document.documentElement.requestFullscreen?.().catch(() => {});
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
        audio: false,
      });
      try {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          recorderRef.current.stop();
        }
      } catch {
        /* replaced below */
      }
      attachStream(stream);
      setCameraLost(false);
    } catch {
      /* stays lost; the overlay remains */
    }
    setBusy(false);
  }

  if (phase === "consent") {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <div className="rounded-xl border border-gray-200 bg-white p-8">
          <h1 className="text-lg font-semibold text-text">Before you begin: this session is recorded</h1>
          <p className="mt-2 text-sm text-text-secondary">
            To keep StaffVA fair for everyone, assessments are proctored:
          </p>
          <ul className="mt-4 space-y-3 text-sm leading-relaxed text-text-secondary">
            {/* One consent version covers both apps, so it has to describe
                what BOTH of them capture. This assessment records video only;
                the interviews also record the room through your microphone.
                Stamping the same 2.1 here while describing less would mean a
                candidate who consented at this gate was counted as having
                agreed to audio nobody mentioned. */}
            <li>
              <strong className="text-text">Your camera records the whole session.</strong> A
              visible indicator stays on screen while it&apos;s recording. In your interviews,
              your microphone is recorded continuously too — that captures the room, not only
              your answers.
            </li>
            <li>
              <strong className="text-text">A person makes any decision.</strong> Automated checks
              review the recording and can flag a session, but only a member of the StaffVA team
              can decide an integrity issue, after watching it. If that happens, you&apos;ll be
              told why and shown the recording.
            </li>
            <li>
              <strong className="text-text">Recordings are deleted unless flagged.</strong> If your
              session isn&apos;t flagged, the recording is deleted right after the automated
              review. If it is flagged, it&apos;s kept until a decision is made and for 7 days
              after.
            </li>
            <li>
              Recording happens only with this consent. You can stop here — but proctored
              assessments are required to join the marketplace.
            </li>
          </ul>
          <label className="mt-6 flex items-start gap-3 text-sm text-text">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>I agree to the recorded, proctored session described above</span>
          </label>
          <div className="mt-5 flex items-center gap-4">
            <button
              onClick={agreeAndContinue}
              disabled={!agreed || busy}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {busy ? "One moment…" : "Continue"}
            </button>
            <a
              href="/privacy"
              target="_blank"
              className="text-xs text-text-secondary underline decoration-border underline-offset-2 hover:text-text"
            >
              Read the full Privacy Policy
            </a>
          </div>
          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>
      </div>
    );
  }

  if (phase === "blocked") {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <h1 className="text-lg font-semibold text-text">A working camera is required</h1>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            Assessments on StaffVA are proctored, and we couldn&apos;t access a camera — it may be
            missing, in use by another app, or blocked in your browser&apos;s permissions. Connect
            one, allow access, and try again. Your progress isn&apos;t lost.
          </p>
          <button
            onClick={requestCamera}
            disabled={busy}
            className="mt-5 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {busy ? "Checking…" : "Try again"}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "camera") {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <div className="rounded-xl border border-gray-200 bg-white p-8">
          <h1 className="text-lg font-semibold text-text">Camera check</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Make sure you&apos;re clearly visible and alone. Recording starts when you begin.
          </p>
          <div className="mt-4 overflow-hidden rounded-lg bg-gray-900">
            <video ref={previewRef} autoPlay muted playsInline className="aspect-video w-full object-cover" />
          </div>
          <button
            onClick={startSession}
            disabled={busy}
            className="mt-5 w-full rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {busy ? "Starting…" : "Begin the proctored test"}
          </button>
          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {children}

      {/* The always-visible indicator: honesty and deterrent in one. */}
      <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-2 shadow-md">
        <video ref={thumbRef} autoPlay muted playsInline className="h-12 w-16 rounded object-cover bg-gray-900" />
        <div className="pr-1">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-text">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />
            Proctored session
          </p>
          <p className="text-[10px] text-text-tertiary">Camera is recording</p>
        </div>
      </div>

      {cameraLost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center">
            <p className="text-sm font-semibold text-text">Camera disconnected</p>
            <p className="mt-2 text-xs leading-relaxed text-text-secondary">
              The proctored session requires your camera. Reconnect it to continue — the test
              timer keeps running, and the interruption is noted in the session record.
            </p>
            <button
              onClick={reconnectCamera}
              disabled={busy}
              className="mt-4 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {busy ? "Reconnecting…" : "Reconnect camera"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
