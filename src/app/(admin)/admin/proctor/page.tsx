"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Proctor Review — the human half of the proctoring consent promise.
 * The cron flags suspicious sessions; nothing was deleted or decided until
 * a person looks here. A decision starts the 7-day footage-deletion clock
 * (the cron owns the deletion itself).
 */

interface CandidateRef { id: string; display_name: string | null; full_name: string | null; email: string | null; country?: string | null; role_category?: string | null; admin_status?: string | null }
interface HumanDecision { decision: string; note: string | null; decided_by_name: string; decided_at: string }
interface Verdict { verdict?: string; categories?: string[]; evidence?: string; confidence?: string; reviewed_by?: string; human_decision?: HumanDecision }
interface Session {
  id: string;
  candidate_id: string;
  session_kind: string;
  storage_prefix: string;
  chunk_count: number;
  frame_count: number;
  camera_lost_count: number;
  started_at: string;
  ended_at: string | null;
  review_status: string;
  verdict: Verdict | null;
  reviewed_at: string | null;
  video_deleted_at: string | null;
  decided_at: string | null;
  candidate: CandidateRef | null;
}
interface Summary { flagged: number; decided: number; oldestFlaggedDays: number | null }
interface SignedFile { name: string; url: string }
interface Detail { session: Session; candidate: CandidateRef | null; frames: SignedFile[]; chunks: SignedFile[]; footage: "present" | "deleted" | "unavailable" }

const FRAME_SAMPLE_TARGET = 60;

function candidateName(c: CandidateRef | null) {
  return c?.display_name || c?.full_name || "Unknown candidate";
}

function fmtKind(kind: string) {
  return kind.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\bAi\b/, "AI");
}

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(started: string, ended: string | null) {
  if (!ended) return "—";
  const s = Math.max(0, Math.round((new Date(ended).getTime() - new Date(started).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/** Frames are captured one per 12s; the filename index gives the offset. */
function frameOffset(name: string) {
  const idx = parseInt(name.replace(/\D/g, ""), 10);
  if (isNaN(idx)) return "";
  const t = idx * 12;
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

function deletionDate(decidedAt: string) {
  return new Date(new Date(decidedAt).getTime() + 7 * 24 * 3600 * 1000);
}

const SEVERE_CATEGORIES = new Set(["second_person", "substitution", "device_use", "coaching"]);

function CategoryChips({ categories }: { categories?: string[] }) {
  if (!categories?.length) return <span className="text-xs text-text-tertiary">no categories</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {categories.map((c) => (
        <span
          key={c}
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            SEVERE_CATEGORIES.has(c) ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
          }`}
        >
          {c.replace(/_/g, " ")}
        </span>
      ))}
    </span>
  );
}

function DecisionBadge({ status }: { status: string }) {
  if (status === "cleared_by_human")
    return <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">Cleared by human</span>;
  if (status === "confirmed_cheating")
    return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Confirmed cheating</span>;
  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{status.replace(/_/g, " ")}</span>;
}

export default function ProctorReviewPage() {
  const [tab, setTab] = useState<"flagged" | "decided">("flagged");
  const [flagged, setFlagged] = useState<Session[]>([]);
  const [decided, setDecided] = useState<Session[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadList = useCallback(() => {
    return fetch("/api/admin/proctor")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setFlagged(data.flagged || []);
          setDecided(data.decided || []);
          setSummary(data.summary || null);
          setLoadFailed(false);
        } else {
          setLoadFailed(true);
        }
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  // A failed fetch must not render as "no sessions awaiting a decision".
  if (loadFailed && !summary) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-text">Proctor Review</h1>
        <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">The review queue could not be loaded.</p>
        <button onClick={() => { setLoading(true); loadList(); }} className="mt-4 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors">Retry</button>
      </div>
    );
  }

  if (selectedId) {
    return <SessionDetail sessionId={selectedId} onBack={() => { setSelectedId(null); loadList(); }} onDecided={loadList} />;
  }

  const rows = tab === "flagged" ? flagged : decided;

  return (
    <div>
      <h1 className="text-2xl font-bold text-text">Proctor Review</h1>
      <p className="mt-1 text-sm text-text-muted">
        Camera-proctored sessions the AI triage flagged for a human decision. Footage is kept until you decide, then deleted 7 days later.
      </p>

      {summary && (
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-border-light bg-card p-4 text-center">
            <p className="text-2xl font-semibold text-primary">{summary.flagged}</p>
            <p className="text-xs text-text-tertiary mt-1">Awaiting Decision</p>
          </div>
          <div className="rounded-2xl border border-border-light bg-card p-4 text-center">
            <p className="text-2xl font-semibold text-text">{summary.decided}</p>
            <p className="text-xs text-text-tertiary mt-1">Decided</p>
          </div>
          <div className="rounded-2xl border border-border-light bg-card p-4 text-center col-span-2 lg:col-span-1">
            <p className="text-2xl font-semibold text-text">{summary.oldestFlaggedDays ?? "—"}</p>
            <p className="text-xs text-text-tertiary mt-1">Days Oldest Has Waited</p>
          </div>
        </div>
      )}

      <div className="mt-8 flex gap-1 border-b border-border-light">
        {(["flagged", "decided"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${tab === t ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text"}`}>
            {t === "flagged" ? `Flagged (${flagged.length})` : `Decided (${summary?.decided ?? decided.length})`}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {rows.length === 0 ? (
          <p className="py-12 text-center text-text-tertiary">
            {tab === "flagged" ? "No sessions awaiting a decision" : "No decided sessions yet"}
          </p>
        ) : (
          rows.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={`block w-full text-left rounded-2xl border p-4 transition-colors hover:border-primary ${
                tab === "flagged" ? "border-amber-200 bg-amber-50" : "border-border-light bg-card"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text truncate">
                    {candidateName(s.candidate)}
                    <span className="ml-2 font-normal text-xs text-text-tertiary">{s.candidate?.email || ""}</span>
                  </p>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    {fmtKind(s.session_kind)} · {fmtWhen(s.started_at)} · {fmtDuration(s.started_at, s.ended_at)} · {s.frame_count} frames · {s.chunk_count} chunks
                  </p>
                  <div className="mt-2"><CategoryChips categories={s.verdict?.categories} /></div>
                  {s.verdict?.evidence && (
                    <p className="mt-2 text-xs text-text-muted line-clamp-2">{s.verdict.evidence}</p>
                  )}
                </div>
                <div className="shrink-0 text-right space-y-1">
                  {tab === "decided" ? (
                    <>
                      <DecisionBadge status={s.review_status} />
                      {s.decided_at && <p className="text-[10px] text-text-tertiary">decided {fmtWhen(s.decided_at)}</p>}
                      <p className="text-[10px] text-text-tertiary">
                        {s.video_deleted_at
                          ? `footage deleted ${new Date(s.video_deleted_at).toLocaleDateString()}`
                          : s.decided_at
                            ? `footage deletes ${deletionDate(s.decided_at).toLocaleDateString()}`
                            : ""}
                      </p>
                    </>
                  ) : (
                    <>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-text-muted border border-amber-200">
                        AI: {s.verdict?.reviewed_by || "?"} · {s.verdict?.confidence || "?"}
                      </span>
                      <p className="text-xs font-medium text-primary">Review →</p>
                    </>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
        {tab === "decided" && summary && summary.decided > decided.length && (
          <p className="pt-2 text-center text-xs text-text-tertiary">Showing the {decided.length} most recent of {summary.decided} decisions.</p>
        )}
      </div>
    </div>
  );
}

function SessionDetail({ sessionId, onBack, onDecided }: { sessionId: string; onBack: () => void; onDecided: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllFrames, setShowAllFrames] = useState(false);
  const [lightbox, setLightbox] = useState<SignedFile | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [decideModal, setDecideModal] = useState<"cleared_by_human" | "confirmed_cheating" | null>(null);
  const [note, setNote] = useState("");
  const [acting, setActing] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const videoUrlRef = useRef<string | null>(null);

  const [detailState, setDetailState] = useState<"ok" | "failed" | "notfound">("ok");

  // Initial state is already loading=true; on later refreshes (after a
  // decision) the detail swaps in place with no full-page spinner.
  const loadDetail = useCallback(() => {
    return fetch(`/api/admin/proctor/${sessionId}`)
      .then((res) => {
        if (res.ok) return res.json();
        setDetailState(res.status === 404 ? "notfound" : "failed");
        return null;
      })
      .then((data) => { if (data) { setDetail(data); setDetailState("ok"); } })
      .catch(() => setDetailState("failed"))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  useEffect(() => () => { if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current); }, []);

  /**
   * The recorder runs one continuous MediaRecorder with a 10s timeslice, so
   * only chunk-00000 carries the WebM header — later chunks are not
   * standalone videos. Concatenating the bytes in order rebuilds the one
   * valid stream, entirely client-side.
   */
  async function loadVideo() {
    if (!detail || videoLoading) return;
    setVideoLoading(true);
    setVideoError(false);
    setVideoProgress(0);
    try {
      const parts: ArrayBuffer[] = [];
      for (let i = 0; i < detail.chunks.length; i++) {
        const res = await fetch(detail.chunks[i].url);
        if (!res.ok) throw new Error(`chunk ${i}`);
        parts.push(await res.arrayBuffer());
        setVideoProgress(i + 1);
      }
      const url = URL.createObjectURL(new Blob(parts, { type: "video/webm" }));
      videoUrlRef.current = url;
      setVideoUrl(url);
    } catch {
      setVideoError(true);
    }
    setVideoLoading(false);
  }

  async function decide(decision: "cleared_by_human" | "confirmed_cheating") {
    setActing(true);
    setActError(null);
    try {
      const res = await fetch("/api/admin/proctor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decide", sessionId, decision, note }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setActError(body?.error || `Failed (${res.status})`);
      } else {
        setDecideModal(null);
        setNote("");
        await loadDetail();
        onDecided();
      }
    } catch {
      setActError("Network error — the decision was not recorded");
    }
    setActing(false);
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  if (!detail) return (
    <div>
      <button onClick={onBack} className="text-sm font-medium text-primary hover:underline">← Back to queue</button>
      {detailState === "failed" ? (
        <>
          <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">This session could not be loaded.</p>
          <button onClick={() => { setLoading(true); loadDetail(); }} className="mt-4 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors">Retry</button>
        </>
      ) : (
        <p className="mt-6 text-text-tertiary">Session not found.</p>
      )}
    </div>
  );

  const { session: s, candidate, frames, chunks } = detail;
  const verdict = s.verdict || {};
  const isFlagged = s.review_status === "flagged";
  const human = verdict.human_decision;

  const frameStep = !showAllFrames && frames.length > FRAME_SAMPLE_TARGET ? Math.ceil(frames.length / FRAME_SAMPLE_TARGET) : 1;
  const visibleFrames = frames.filter((_, i) => i % frameStep === 0);

  return (
    <div>
      <button onClick={onBack} className="text-sm font-medium text-primary hover:underline">← Back to queue</button>

      <div className="mt-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-text">{candidateName(candidate)}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {candidate?.email} {candidate?.country ? `· ${candidate.country}` : ""} {candidate?.role_category ? `· ${candidate.role_category}` : ""}
          </p>
          <p className="mt-1 text-xs text-text-tertiary">
            {fmtKind(s.session_kind)} · started {fmtWhen(s.started_at)} · lasted {fmtDuration(s.started_at, s.ended_at)}
          </p>
        </div>
        <div className="text-right space-y-1">
          <DecisionBadge status={s.review_status} />
          {s.decided_at && (
            <p className="text-[11px] text-text-tertiary">
              decided {fmtWhen(s.decided_at)}
              {human?.decided_by_name ? ` by ${human.decided_by_name}` : ""}
            </p>
          )}
        </div>
      </div>

      {/* Decision record for decided sessions */}
      {human && (
        <div className={`mt-4 rounded-2xl border p-4 ${s.review_status === "confirmed_cheating" ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}`}>
          <p className="text-sm font-semibold text-text">
            {s.review_status === "confirmed_cheating" ? "Cheating confirmed" : "Cleared"} by {human.decided_by_name} · {fmtWhen(human.decided_at)}
          </p>
          {human.note && <p className="mt-1 text-xs text-text-muted">“{human.note}”</p>}
          {s.review_status === "confirmed_cheating" && (
            <p className="mt-2 text-xs text-red-700">
              No action has been taken against the candidate — what a confirmed session means for them is a pending owner decision.
            </p>
          )}
          <p className="mt-1 text-xs text-text-tertiary">
            {s.video_deleted_at
              ? `Footage deleted ${new Date(s.video_deleted_at).toLocaleDateString()}.`
              : s.decided_at
                ? `Footage will be deleted automatically on ${deletionDate(s.decided_at).toLocaleDateString()}.`
                : ""}
          </p>
        </div>
      )}

      {/* AI verdict */}
      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CategoryChips categories={verdict.categories} />
          <span className="text-[11px] text-text-tertiary">
            flagged by {verdict.reviewed_by || "?"} · confidence {verdict.confidence || "?"}
            {s.reviewed_at ? ` · ${fmtWhen(s.reviewed_at)}` : ""}
          </span>
        </div>
        <p className="mt-2 text-sm text-text">{verdict.evidence || "No evidence text recorded."}</p>
        <p className="mt-2 text-xs text-text-tertiary">
          {s.frame_count} frames (one per 12s) · {s.chunk_count} video chunks (10s each) · camera lost {s.camera_lost_count}×
        </p>
      </div>

      {/* Footage */}
      {detail.footage === "deleted" ? (
        <p className="mt-6 rounded-2xl border border-border-light bg-card p-6 text-center text-sm text-text-tertiary">
          The footage for this session has been deleted{s.video_deleted_at ? ` (${new Date(s.video_deleted_at).toLocaleDateString()})` : ""}. Only the verdict above remains.
        </p>
      ) : detail.footage === "unavailable" ? (
        <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
          Storage did not answer when listing this session&apos;s footage — reload to retry.
        </p>
      ) : (
        <>
          {/* Frame strip */}
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text">Review frames ({frames.length})</h2>
              {frames.length > FRAME_SAMPLE_TARGET && (
                <button onClick={() => setShowAllFrames(!showAllFrames)} className="text-xs font-medium text-primary hover:underline">
                  {showAllFrames ? `Sample every ${Math.ceil(frames.length / FRAME_SAMPLE_TARGET)}th` : `Show all ${frames.length}`}
                </button>
              )}
            </div>
            {frames.length === 0 ? (
              <p className="mt-3 rounded-xl border border-border-light bg-card p-4 text-center text-xs text-text-tertiary">No frames were stored for this session.</p>
            ) : (
              <div className="mt-3 grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
                {visibleFrames.map((f) => (
                  <button key={f.name} onClick={() => setLightbox(f)} className="group relative rounded-lg overflow-hidden border border-border-light bg-black/5 aspect-video">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.url} alt={f.name} loading="lazy" className="h-full w-full object-cover" />
                    <span className="absolute bottom-0 right-0 bg-black/60 px-1 text-[9px] text-white">{frameOffset(f.name)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Video */}
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-text">Video ({chunks.length} chunks)</h2>
            {chunks.length === 0 ? (
              <p className="mt-3 rounded-xl border border-border-light bg-card p-4 text-center text-xs text-text-tertiary">No video chunks were stored for this session.</p>
            ) : videoUrl ? (
              <video src={videoUrl} controls autoPlay className="mt-3 w-full max-w-2xl rounded-xl border border-border-light bg-black" />
            ) : (
              <div className="mt-3 rounded-xl border border-border-light bg-card p-4">
                <button
                  onClick={loadVideo}
                  disabled={videoLoading}
                  className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50 transition-colors"
                >
                  {videoLoading ? `Loading chunk ${videoProgress}/${chunks.length}…` : `Load video (${chunks.length} × 10s chunks)`}
                </button>
                {videoError && <p className="mt-2 text-xs text-red-600">Some chunks failed to download — try again.</p>}
                <p className="mt-2 text-xs text-text-tertiary">Chunks are one continuous recording; they are stitched in your browser and never leave StaffVA storage.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Decision bar */}
      {isFlagged && (
        <div className="mt-8 rounded-2xl border border-border-light bg-card p-5">
          <h2 className="text-sm font-semibold text-text">Your decision</h2>
          <p className="mt-1 text-xs text-text-muted">
            Either way, the footage is deleted automatically 7 days after you decide. Confirming cheating records the finding on this session only —
            it does not block or demote the candidate; consequences are a separate owner decision.
          </p>
          <div className="mt-4 flex gap-3">
            <button onClick={() => { setDecideModal("cleared_by_human"); setNote(""); setActError(null); }} className="rounded-full bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 transition-colors">
              Clear — nothing wrong here
            </button>
            <button onClick={() => { setDecideModal("confirmed_cheating"); setNote(""); setActError(null); }} className="rounded-full border border-red-300 bg-red-50 px-5 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 transition-colors">
              Confirm cheating
            </button>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox.url} alt={lightbox.name} className="max-h-full max-w-full rounded-lg" />
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/70">{lightbox.name} · {frameOffset(lightbox.name)} into the session</span>
        </div>
      )}

      {/* Decide modal */}
      {decideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDecideModal(null)}>
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-text">
              {decideModal === "cleared_by_human" ? "Clear this session?" : "Confirm cheating?"}
            </h2>
            <p className="mt-2 text-sm text-text-muted">
              {decideModal === "cleared_by_human"
                ? "Records that a human reviewed the footage and found nothing wrong. The footage will be deleted automatically 7 days from now."
                : "Records that a human confirmed cheating in this session. The footage is kept as evidence for 7 more days, then deleted. The candidate is NOT blocked, demoted, or notified by this — what happens to them is a pending owner decision."}
            </p>
            <p className="mt-2 text-xs text-amber-700">This cannot be undone, and it starts the 7-day deletion clock on the footage.</p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional) — what you saw, for the record"
              rows={3}
              className="mt-4 w-full rounded-xl border border-border-light bg-background px-4 py-3 text-sm text-text placeholder-text-tertiary focus:border-primary focus:outline-none resize-none"
            />
            {actError && <p className="mt-2 text-xs text-red-600">{actError}</p>}
            <div className="mt-4 flex gap-3">
              <button onClick={() => setDecideModal(null)} className="flex-1 rounded-full border border-border py-2.5 text-sm font-medium text-text hover:border-text transition-colors">Cancel</button>
              <button
                onClick={() => decide(decideModal)}
                disabled={acting}
                className={`flex-1 rounded-full py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-colors ${
                  decideModal === "cleared_by_human" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {acting ? "…" : decideModal === "cleared_by_human" ? "Clear session" : "Confirm cheating"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
