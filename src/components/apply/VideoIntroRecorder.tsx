"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The prompted video introduction: one continuous take, four prompts.
 *
 * ONE recording, not four. Four separate MediaRecorder runs each carry their
 * own EBML header, and joining them gives players a file they stop reading at
 * the end of the first segment — an intro that plays only "Tell us who you
 * are". Chunks from a single recorder are byte-slices of one stream and rejoin
 * into exactly the original file, which is what makes the chunked upload below
 * safe.
 *
 * The prompts advance off the RECORDER's clock, not off a setTimeout schedule
 * started before the camera opened. Camera warm-up is one to three seconds on a
 * low-end Android, and a backgrounded tab throttles timers to ~1s while the
 * encoder keeps real time — so a wall-clock schedule drifts away from the video
 * it claims to describe, and the stored section offsets would be fiction.
 *
 * Chunks upload WHILE recording. By the time the candidate presses Stop, most
 * of the file is already durable, and a take is only spent once the whole thing
 * is saved. A failed upload costs nothing, and the copy says so.
 */

/**
 * Four prompts, 75 seconds. These are StaffVA's OWN four — the ones already
 * written on the video-intro page — not Atlas's. Atlas asks "Why are you on
 * Atlas?", which has no useful answer in a marketplace where every candidate
 * arrived the same way, and its prompts assume a portfolio career rather than
 * a client-facing assistant introducing themselves to a buyer.
 */
const SECTIONS = [
  { prompt: "Greet the viewer, using your first name.", ms: 18_000 },
  { prompt: "Your background — experience, industries, what you specialise in.", ms: 19_000 },
  { prompt: "What you bring a client: the problems you solve.", ms: 19_000 },
  { prompt: "Close: why you'd like to work with them.", ms: 19_000 },
];
const TOTAL_MS = SECTIONS.reduce((a, s) => a + s.ms, 0); // 75s
const MIN_MS = 45_000;
const TIMESLICE_MS = 4_000;

type Phase = "idle" | "ready" | "recording" | "saving" | "done" | "error";

interface PendingChunk {
  n: number;
  blob: Blob;
  attempts: number;
}

export default function VideoIntroRecorder({
  takesRemaining,
  onSaved,
}: {
  takesRemaining: number;
  onSaved: (remaining: number) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [sectionIdx, setSectionIdx] = useState(0);
  const [error, setError] = useState("");
  const [produced, setProduced] = useState(0);
  const [acked, setAcked] = useState(0);
  const [offline, setOffline] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const takeIdRef = useRef<string>("");
  const t0Ref = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const chunkNRef = useRef(0);
  const pendingRef = useRef<Map<number, PendingChunk>>(new Map());
  const ackedRef = useRef(0);
  const sectionsRef = useRef<{ index: number; prompt: string; start_ms: number }[]>([]);
  const stoppedRef = useRef(false);
  const sweepRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Whatever the browser actually chose, so the chunk and finalize routes
  // store the real content type rather than assuming WebM.
  const mimeRef = useRef<string>("video/webm");
  const hardStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Upload one chunk, with retry ──
  const inFlightRef = useRef<Set<number>>(new Set());

  const sendChunk = useCallback(async (c: PendingChunk) => {
    // The retry sweep and finalize's drain loop both walk the pending map, so
    // without this the same chunk is posted twice, acked twice, and the
    // progress readout climbs past 100%.
    if (inFlightRef.current.has(c.n)) return;
    inFlightRef.current.add(c.n);
    try {
      const res = await fetch(
        `/api/candidate/video-intro/chunk?take=${takeIdRef.current}&n=${c.n}`,
        { method: "POST", body: c.blob, headers: { "Content-Type": "application/octet-stream" } }
      );
      if (res.ok) {
        pendingRef.current.delete(c.n);
        ackedRef.current += 1;
        setAcked(ackedRef.current);
        setOffline(false);
        return;
      }
      if (res.status === 409) {
        // Stop first. Setting the error phase alone left the recorder running
        // and the camera live, so "Try again" opened a second stream on top of
        // the first.
        stoppedRef.current = true;
        if (hardStopRef.current) clearTimeout(hardStopRef.current);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        try { recorderRef.current?.stop(); } catch { /* already stopped */ }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        pendingRef.current.clear();
        setError("You've used both takes.");
        setPhase("error");
        return;
      }
      throw new Error(String(res.status));
    } catch {
      // Held, not dropped. The sweep retries it; the blob stays in memory
      // until the server has acknowledged it.
      c.attempts += 1;
      setOffline(true);
    } finally {
      inFlightRef.current.delete(c.n);
    }
  }, []);

  // Retry sweep: anything still outstanding, oldest first.
  useEffect(() => {
    sweepRef.current = setInterval(() => {
      const outstanding = [...pendingRef.current.values()].sort((a, b) => a.n - b.n);
      for (const c of outstanding.slice(0, 3)) void sendChunk(c);
    }, 5_000);
    return () => {
      if (sweepRef.current) clearInterval(sweepRef.current);
    };
  }, [sendChunk]);

  // ── Camera ──
  async function openCamera() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // 480p24, not 720p30. The previous recorder asked for 1280x720 and
        // passed no bitrate at all, which on a talking head produces 10-25MB
        // for 75 seconds — several minutes of upload on a 1 Mbps uplink. This
        // is roughly a sixth of the pixel rate with a ceiling on it, and still
        // well above the proctor's 15fps, which reads as broken for a face.
        video: { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        await videoRef.current.play().catch(() => {});
      }
      setPhase("ready");
    } catch {
      setError("We couldn't reach your camera. Check the browser's permission prompt and try again.");
      setPhase("error");
    }
  }

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (hardStopRef.current) clearTimeout(hardStopRef.current);
    };
  }, []);

  /**
   * Safari/WebKit does not support WebM in MediaRecorder at all — it records
   * MP4. A list of WebM types with a WebM fallback therefore hands
   * `new MediaRecorder(stream, {mimeType: "video/webm"})` to every iPhone,
   * which throws NotSupportedError, and the Start button does nothing forever.
   *
   * Returning undefined lets the browser pick its own default, which is always
   * something it can actually encode. That is the correct last resort, not a
   * format we hope is there.
   */
  function pickMime(): string | undefined {
    const candidates = [
      "video/webm;codecs=vp8,opus", // vp8 encodes far cheaper than vp9 on low-end Android
      "video/webm;codecs=vp9,opus",
      "video/webm",
      "video/mp4;codecs=avc1,mp4a",  // Safari
      "video/mp4",
    ];
    const supported = candidates.find(
      (m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)
    );
    return supported;
  }

  // ── Record ──
  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;

    takeIdRef.current = crypto.randomUUID();
    chunkNRef.current = 0;
    ackedRef.current = 0;
    pendingRef.current.clear();
    sectionsRef.current = [];
    stoppedRef.current = false;
    setProduced(0);
    setAcked(0);
    setSectionIdx(0);
    setElapsed(0);
    setError("");

    const mimeType = pickMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, {
        // Omit mimeType entirely when nothing on our list is supported, rather
        // than passing a string the browser will reject.
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 600_000,
        audioBitsPerSecond: 64_000,
      });
    } catch {
      try {
        // Last resort: no constraints at all. A bigger file beats no recording.
        rec = new MediaRecorder(stream);
      } catch {
        setError("This browser can't record video. Try Chrome, or a different device.");
        setPhase("error");
        return;
      }
    }
    mimeRef.current = rec.mimeType || mimeType || "video/webm";

    rec.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      // The first chunk is delivered one TIMESLICE after recording began, not
      // at the moment it began. Anchoring t0 here made every stored section
      // offset and the stored duration 4 seconds short — so the offsets, whose
      // whole job is to say where in the file each answer starts, pointed
      // consistently into the previous answer.
      if (t0Ref.current === 0) {
        t0Ref.current = performance.now() - TIMESLICE_MS;
        sectionsRef.current.push({ index: 0, prompt: SECTIONS[0].prompt, start_ms: 0 });
      }
      const n = chunkNRef.current++;
      const c: PendingChunk = { n, blob: e.data, attempts: 0 };
      pendingRef.current.set(n, c);
      setProduced(chunkNRef.current);
      void sendChunk(c);
    };

    rec.onstop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // Only a deliberate stop finalizes. A recorder can stop for reasons that
      // are not the candidate finishing — the camera track ending, the device
      // sleeping, the OS reclaiming the encoder — and finalizing those would
      // spend a take on a fragment.
      if (!stoppedRef.current) {
        setError(
          "Your camera stopped before the recording finished, so this take doesn't count. " +
            "Check the camera and record again."
        );
        setPhase("error");
        return;
      }
      const recorded = t0Ref.current === 0 ? 0 : performance.now() - t0Ref.current;
      if (recorded < MIN_MS) {
        setError(
          `That recording was only ${Math.round(recorded / 1000)} seconds. ` +
            "It hasn't been saved and doesn't count — record again when you're ready."
        );
        setPhase("error");
        return;
      }
      void finalize();
    };

    recorderRef.current = rec;
    t0Ref.current = 0;
    rec.start(TIMESLICE_MS);
    setPhase("recording");

    // A hard ceiling that does NOT depend on requestAnimationFrame.
    //
    // rAF stops firing entirely in a backgrounded tab while the encoder keeps
    // running in real time. With rAF as the only thing calling stop(), a
    // candidate who switches apps mid-take records until the tab is closed —
    // an unbounded file, an unbounded upload, and a "75-second intro" that is
    // eleven minutes long. setTimeout is throttled in the background but it
    // still fires, so it is the right instrument for a deadline.
    //
    // Generous by one timeslice so it never pre-empts the rAF path in the
    // normal case, where the prompts and the stop should stay in step.
    hardStopRef.current = setTimeout(() => stop(), TOTAL_MS + TIMESLICE_MS + 2_000);

    // Prompt advance, off the recorder's clock.
    const tick = () => {
      if (stoppedRef.current) return;
      const now = t0Ref.current === 0 ? 0 : performance.now() - t0Ref.current;
      setElapsed(now);

      let acc = 0;
      let idx = 0;
      for (let i = 0; i < SECTIONS.length; i++) {
        if (now >= acc) idx = i;
        acc += SECTIONS[i].ms;
      }
      setSectionIdx((prev) => {
        if (idx !== prev && !sectionsRef.current.some((s) => s.index === idx)) {
          sectionsRef.current.push({ index: idx, prompt: SECTIONS[idx].prompt, start_ms: Math.round(now) });
        }
        return idx;
      });

      if (now >= TOTAL_MS) {
        stop();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function stop() {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    if (hardStopRef.current) clearTimeout(hardStopRef.current);
    setPhase("saving");
    try {
      recorderRef.current?.stop();
    } catch {
      /* already stopped */
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  // ── Finalize ──
  async function finalize() {
    const durationMs = t0Ref.current === 0 ? 0 : Math.round(performance.now() - t0Ref.current);

    // Wait for the outstanding tail, but not forever.
    const deadline = Date.now() + 90_000;
    while (pendingRef.current.size > 0 && Date.now() < deadline) {
      const outstanding = [...pendingRef.current.values()].sort((a, b) => a.n - b.n);
      await Promise.all(outstanding.slice(0, 3).map((c) => sendChunk(c)));
      if (pendingRef.current.size > 0) await new Promise((r) => setTimeout(r, 1200));
    }

    if (pendingRef.current.size > 0) {
      setError(
        "Some parts of your recording didn't finish uploading, so this take doesn't count. " +
          "Check your connection and record again when you're ready."
      );
      setPhase("error");
      return;
    }

    try {
      const res = await fetch("/api/candidate/video-intro/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          takeId: takeIdRef.current,
          chunkCount: chunkNRef.current,
          durationMs,
          sections: sectionsRef.current,
          // The container the recorder ACTUALLY produced. Safari records MP4;
          // storing it as video/webm made the candidate's own intro (and the
          // admin review player) refuse to play it back on the same device.
          mimeType: mimeRef.current,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.error ||
            "We couldn't save your recording, so this take doesn't count. Try again."
        );
        setPhase("error");
        return;
      }
      setPhase("done");
      onSaved(data.takesRemaining ?? 0);
    } catch {
      // Deliberately does NOT say "this take doesn't count". The request may
      // have reached the server and committed consume_video_take before the
      // response was lost, in which case the take WAS spent and the recording
      // is saved. Claiming otherwise would be a false promise in the direction
      // that matters — the candidate would expect a take they no longer have.
      setError(
        "We lost the connection while saving. Reload this page to see whether your " +
          "recording went through before recording again."
      );
      setPhase("error");
    }
  }

  const secondsLeft = Math.max(0, Math.ceil((TOTAL_MS - elapsed) / 1000));
  const canStop = elapsed >= MIN_MS;
  const uploadPct = produced === 0 ? 0 : Math.round((acked / produced) * 100);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-bold text-text">Record your introduction</h2>
        <span className="text-xs font-medium text-text/60">
          {takesRemaining} {takesRemaining === 1 ? "take" : "takes"} left
        </span>
      </div>
      <p className="mt-1 text-sm text-text/60">
        One continuous recording, about 75 seconds, with four things to talk about. You get two
        takes — and a take only counts once it&apos;s saved. If the upload doesn&apos;t finish,
        it doesn&apos;t count.
      </p>

      <div className="relative mt-4 overflow-hidden rounded-lg bg-gray-900" style={{ aspectRatio: "16/9" }}>
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
        />
        {phase === "recording" && (
          <>
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <span className="text-xs font-medium text-white">{secondsLeft}s left</span>
            </div>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-5">
              <p className="text-xs font-medium uppercase tracking-wider text-white/50">
                {sectionIdx + 1} of {SECTIONS.length}
              </p>
              <p className="mt-1 text-xl font-semibold text-white">{SECTIONS[sectionIdx].prompt}</p>
            </div>
          </>
        )}
      </div>

      {/* Real progress: chunks the server has acknowledged, over chunks
          produced. Not a timer pretending to be a measurement. */}
      {(phase === "recording" || phase === "saving") && produced > 0 && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${uploadPct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-text/50">
            {offline
              ? "Waiting for connection — the parts already uploaded are safe."
              : `Saving as you go — ${acked} of ${produced} parts uploaded.`}
          </p>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {phase === "idle" && (
          <button
            type="button"
            onClick={openCamera}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white"
          >
            Turn on my camera
          </button>
        )}
        {phase === "ready" && (
          <button
            type="button"
            onClick={startRecording}
            disabled={takesRemaining <= 0}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Start recording
          </button>
        )}
        {phase === "recording" && (
          <button
            type="button"
            onClick={stop}
            disabled={!canStop}
            className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-text disabled:opacity-50"
          >
            {canStop
              ? "Stop and save"
              : `Keep going — ${Math.ceil((MIN_MS - elapsed) / 1000)}s minimum`}
          </button>
        )}
        {phase === "saving" && (
          <span className="text-sm text-text/60">Saving your recording…</span>
        )}
        {phase === "done" && (
          <p className="text-sm font-medium text-green-700">
            Saved. A StaffVA specialist will review it with the rest of your profile.
          </p>
        )}
        {phase === "error" && takesRemaining > 0 && (
          <button
            type="button"
            onClick={() => {
              setPhase("idle");
              setError("");
            }}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
