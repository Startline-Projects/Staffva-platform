"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One proctor session: the frames the reviewer model saw, and the video.
 *
 * The frames come first and load at once. They are what the AI verdict cites
 * ("frames 5–14 …"), they cost a few KB each, and scanning a filmstrip is how
 * a person finds the thirty seconds worth watching in a fifty-minute file.
 *
 * The video is assembled on request. It is stored as numbered MediaRecorder
 * slices of a single stream — only slice 0 has the WebM header — so no slice
 * plays on its own and there is no URL to hand a <video>. They are fetched in
 * order and joined into one Blob. That means the whole recording downloads
 * before playback starts, which for the longest session on file is ~100 MB;
 * hence a button with the size on it rather than autoplay.
 *
 * A missing slice does NOT end the recording. Measured with real MediaRecorder
 * output: the joined file still loads, its length still resolves, seeking still
 * works, and everything before the gap decodes cleanly — the picture after it
 * is broken until the stream's next keyframe. So every stored slice is joined,
 * gap or not. Cutting at the first gap, which this did at first, would have
 * dropped the last three and a half minutes of the one session on file flagged
 * for a candidate being absent. Only if the browser actually refuses the joined
 * file does it fall back to the part before the gap.
 */

interface Chunk { n: number; size: number; url: string }
interface Frame { n: number; url: string }
interface Files { chunks: Chunk[]; frames: Frame[]; missingChunks: number[] }

/** Slices are cut every 10 s by both recorders (CHUNK_MS). */
const SLICE_SECONDS = 10;
const PARALLEL = 4;

const mb = (bytes: number) => (bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function FootagePlayer({ sessionId }: { sessionId: string }) {
  const [files, setFiles] = useState<Files | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [video, setVideo] = useState<{ k: "idle" } | { k: "loading"; done: number; of: number } | { k: "ready"; url: string } | { k: "error"; msg: string }>({ k: "idle" });
  const objectUrl = useRef<string | null>(null);
  /** Downloaded slices, kept so the pre-gap fallback does not fetch them again. */
  const downloaded = useRef<{ n: number; blob: Blob }[]>([]);
  const [cutAtGap, setCutAtGap] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/recordings/session/${sessionId}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) { setError(body.error ?? `The recording could not be opened (${r.status}).`); return; }
        setFiles({ chunks: body.chunks ?? [], frames: body.frames ?? [], missingChunks: body.missingChunks ?? [] });
      })
      .catch(() => { if (alive) setError("The server could not be reached."); });
    return () => { alive = false; };
  }, [sessionId]);

  // A 100 MB Blob stays alive as long as its object URL does.
  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);

  const assemble = useCallback(async () => {
    if (!files) return;
    const usable = files.chunks;
    if (usable.length === 0) return;

    setVideo({ k: "loading", done: 0, of: usable.length });
    const parts: Blob[] = new Array(usable.length);
    let next = 0, done = 0, failed = false;

    async function worker() {
      while (!failed) {
        const i = next++;
        if (i >= usable.length) return;
        try {
          const res = await fetch(usable[i].url);
          if (!res.ok) throw new Error(String(res.status));
          parts[i] = await res.blob();
          setVideo({ k: "loading", done: ++done, of: usable.length });
        } catch {
          failed = true;
        }
      }
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker));

    if (failed) {
      setVideo({ k: "error", msg: "A slice failed to download — the links last an hour, so reopen this session and try again." });
      return;
    }
    downloaded.current = usable.map((c, i) => ({ n: c.n, blob: parts[i] }));
    const url = URL.createObjectURL(new Blob(parts, { type: "video/webm" }));
    objectUrl.current = url;
    setVideo({ k: "ready", url });
  }, [files]);

  /** The browser refused the joined file: rebuild from the slices before the first gap. */
  const fallBackToBeforeGap = useCallback(() => {
    if (!files || cutAtGap || files.missingChunks.length === 0) return;
    const firstGap = files.missingChunks[0];
    const prefix = downloaded.current.filter((d) => d.n < firstGap).map((d) => d.blob);
    if (prefix.length === 0) return;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    const url = URL.createObjectURL(new Blob(prefix, { type: "video/webm" }));
    objectUrl.current = url;
    setCutAtGap(true);
    setVideo({ k: "ready", url });
  }, [files, cutAtGap]);

  if (error) return <p className="rec-note-line" style={{ color: "var(--danger)" }} role="alert">{error}</p>;
  if (!files) return <div className="adm-skeleton" style={{ height: 84 }} />;

  const { chunks, frames, missingChunks } = files;
  const totalBytes = chunks.reduce((s, c) => s + c.size, 0);
  const recordedSeconds = chunks.length * SLICE_SECONDS;
  // Frame spacing has changed between builds (one session holds two frames per
  // slice), so when a frame was taken is derived from this session's own
  // counts rather than from today's interval constant.
  const at = (n: number) => (frames.length ? (n / frames.length) * recordedSeconds : 0);
  const headerMissing = missingChunks.includes(0) || (chunks.length > 0 && chunks[0].n !== 0);
  const shown = focus !== null ? frames.find((f) => f.n === focus) ?? null : null;

  return (
    <div className="rcd-player">
      {frames.length > 0 ? (
        <>
          {shown && (
            <div className="rcd-frame-focus">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shown.url} alt={`Frame ${shown.n}, about ${clock(at(shown.n))} in`} />
              <div className="rcd-frame-caption">
                frame {shown.n} · ≈ {clock(at(shown.n))} into the recording
                <button type="button" className="row-link" onClick={() => setFocus(null)}>close</button>
              </div>
            </div>
          )}
          <div className="rcd-filmstrip" role="list" aria-label="Review frames">
            {frames.map((f) => (
              <button
                key={f.n} type="button" role="listitem"
                className={`rcd-frame${focus === f.n ? " on" : ""}`}
                onClick={() => setFocus(focus === f.n ? null : f.n)}
                title={`frame ${f.n} · ≈ ${clock(at(f.n))}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt="" loading="lazy" />
                <span>{f.n}</span>
              </button>
            ))}
          </div>
          <p className="rec-note-line">
            {frames.length} review frames — the stills the automated reviewer was shown, numbered the way its
            verdict cites them. Times are approximate.
          </p>
        </>
      ) : (
        <p className="rec-note-line">No review frames were stored for this session.</p>
      )}

      <div className="rcd-video">
        {video.k === "ready" ? (
          <>
            <FixedDurationVideo src={video.url} onDecodeError={fallBackToBeforeGap} />
            {missingChunks.length > 0 && (
              <p className="rec-note-line" style={{ marginTop: 8 }}>
                {cutAtGap
                  ? `This browser could not play across the missing slice, so this is the recording up to ≈ ${clock(missingChunks[0] * SLICE_SECONDS)}. ${chunks.filter((c) => c.n > missingChunks[0]).length} later slices are stored but not shown; the review frames above cover the whole session.`
                  : `${missingChunks.length} slice${missingChunks.length === 1 ? " is" : "s are"} missing from storage, the first at ≈ ${clock(missingChunks[0] * SLICE_SECONDS)}. The rest is joined across it — expect the picture to break up there until the recording's next keyframe. The review frames above are not affected.`}
              </p>
            )}
          </>
        ) : chunks.length === 0 ? (
          <p className="rec-note-line">No video was stored for this session.</p>
        ) : headerMissing ? (
          <p className="rec-note-line" style={{ color: "var(--danger)" }}>
            The first video slice is missing from storage. It carries the header every later slice depends on, so
            this recording cannot be played. The frames above are what remains.
          </p>
        ) : (
          <>
            <button type="button" className="adm-btn" disabled={video.k === "loading"} onClick={assemble}>
              {video.k === "loading"
                ? `Downloading ${video.done} of ${video.of}…`
                : `Load video · ${clock(recordedSeconds)} · ${mb(totalBytes)} MB`}
            </button>
            {video.k === "error" && <p className="rec-note-line" style={{ color: "var(--danger)", marginTop: 8 }}>{video.msg}</p>}
            {missingChunks.length > 0 && (
              <p className="rec-note-line" style={{ marginTop: 8 }}>
                {missingChunks.length} of {chunks.length + missingChunks.length} slices{" "}
                {missingChunks.length === 1 ? "is" : "are"} missing from storage, the first at ≈{" "}
                {clock(missingChunks[0] * SLICE_SECONDS)}. Everything stored is still loaded.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * MediaRecorder writes WebM with no duration, so the browser reports Infinity
 * and the scrubber is dead. Seeking far past the end makes it read to the last
 * cluster and learn the real length; then go back to the start.
 */
function FixedDurationVideo({ src, onDecodeError }: { src: string; onDecodeError: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onMeta = () => {
      if (Number.isFinite(v.duration)) return;
      const back = () => { v.removeEventListener("timeupdate", back); v.currentTime = 0; };
      v.addEventListener("timeupdate", back);
      v.currentTime = Number.MAX_SAFE_INTEGER;
    };
    v.addEventListener("loadedmetadata", onMeta);
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [src]);

  return <video ref={ref} src={src} controls playsInline className="rcd-video-el" onError={onDecodeError} />;
}
