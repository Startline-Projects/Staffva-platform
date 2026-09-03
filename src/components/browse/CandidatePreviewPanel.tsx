"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { getEarningsBucketLabel } from "./CandidateCard";

interface PanelProps {
  candidateId: string | null;
  onClose: () => void;
  onSkillClick?: (skill: string) => void;
}

interface PanelData {
  candidate: {
    id: string;
    display_name: string;
    first_name: string | null;
    country: string;
    role_category: string;
    time_zone: string;
    hourly_rate: number;
    bio: string | null;
    tagline: string | null;
    profile_photo_url: string | null;
    skills: string[] | null;
    tools: string[] | null;
    work_experience: { company_name?: string; role_title: string; industry: string; duration: string; description: string; start_date?: string; end_date?: string }[] | null;
    reputation_score: number | null;
    reputation_tier: string | null;
    total_earnings_usd: number;
    committed_hours: number;
  };
  aiInterview: { overall_score: number; technical_knowledge_score: number; problem_solving_score: number; communication_score: number; experience_depth_score: number; professionalism_score: number; passed: boolean } | null;
  review: { rating: number; body: string | null; submitted_at: string; clientName: string | null } | null;
  reviewCount: number;
  relationship: "none" | "messaged" | "engaged";
  voicePreviewSignedUrl: string | null;
}

export default function CandidatePreviewPanel({ candidateId, onClose, onSkillClick }: PanelProps) {
  // One state, keyed by the candidate it belongs to — loading and error are
  // derived from whether the result on hand matches the open candidate, so
  // a slow response for A can never dress itself up as B.
  const [result, setResult] = useState<{ forId: string; data: PanelData | null } | null>(null);
  const [fade, setFade] = useState(false);
  // Reset-on-switch state is keyed by candidate id and derived at render
  // time instead of being synced in the effect.
  const [expandedForId, setExpandedForId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevIdRef = useRef<string | null>(null);
  const cleanupTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!candidateId) return;

    // Fade transition when switching candidates (async so the effect itself
    // doesn't set state synchronously)
    if (prevIdRef.current && prevIdRef.current !== candidateId) {
      const fadeIn = setTimeout(() => setFade(true), 0);
      const fadeOut = setTimeout(() => setFade(false), 150);
      cleanupTimersRef.current = [fadeIn, fadeOut];
    }
    prevIdRef.current = candidateId;

    const controller = new AbortController();
    fetch(`/api/candidates/preview?id=${candidateId}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        if (controller.signal.aborted) return;
        if (d.candidate) {
          setResult({ forId: candidateId, data: d });
          // Auto-play voice preview
          if (d.voicePreviewSignedUrl) {
            if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
            window.dispatchEvent(new CustomEvent("staffva-stop-audio"));
            const audio = new Audio(d.voicePreviewSignedUrl);
            audio.volume = muted ? 0 : 1;
            audioRef.current = audio;
            audio.play().catch(() => {}); // Browser may block
          }
        } else {
          setResult({ forId: candidateId, data: null });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ forId: candidateId, data: null });
      });

    return () => {
      controller.abort();
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      cleanupTimersRef.current.forEach(clearTimeout);
      cleanupTimersRef.current = [];
    };
  }, [candidateId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : 1;
  }, [muted]);

  // Stop audio on global event
  useEffect(() => {
    function handleStop() { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } }
    window.addEventListener("staffva-stop-audio", handleStop);
    return () => window.removeEventListener("staffva-stop-audio", handleStop);
  }, []);

  if (!candidateId) return null;

  // Everything below derives from the (id-keyed) result.
  const loading = result?.forId !== candidateId;
  const failed = !loading && result!.data === null;
  const data = loading ? null : result!.data;
  const bioExpanded = expandedForId === candidateId;
  const c = data?.candidate;
  const firstName = c?.first_name || c?.display_name?.split(" ")[0] || "Professional";
  const localTime = (() => {
    try { return new Date().toLocaleTimeString("en-US", { timeZone: c?.time_zone || "UTC", hour: "numeric", minute: "2-digit" }); } catch { return ""; }
  })();
  const availColor = !c?.committed_hours || c.committed_hours === 0 ? "#27a35f" : c.committed_hours < 40 ? "var(--amber)" : "#9a9689";
  const earningsLabel = getEarningsBucketLabel(c?.total_earnings_usd);
  const skills = [...(c?.skills || []), ...(c?.tools || [])];
  const workExp = (c?.work_experience || []).slice(0, 2);

  const scoreRows = data?.aiInterview && data.aiInterview.passed
    ? [
        { label: "Technical knowledge", score: Math.round(data.aiInterview.technical_knowledge_score * 5) },
        { label: "Communication", score: Math.round(data.aiInterview.communication_score * 5) },
        { label: "Problem solving", score: Math.round(data.aiInterview.problem_solving_score * 5) },
        { label: "Experience depth", score: Math.round(data.aiInterview.experience_depth_score * 5) },
        { label: "Professionalism", score: Math.round(data.aiInterview.professionalism_score * 5) },
      ]
    : [];

  const ctas = c ? (
    data?.relationship === "engaged" ? (
      <>
        <Link href={`/hire/${c.id}/offer`} className="btn btn-lime">Hire Again</Link>
        <Link href="/team" className="btn btn-outline">View Engagement</Link>
      </>
    ) : data?.relationship === "messaged" ? (
      <>
        <Link href={`/inbox?candidate=${c.id}`} className="btn btn-primary">Continue Conversation</Link>
        <Link href={`/hire/${c.id}/offer`} className="btn btn-lime">Hire Now</Link>
      </>
    ) : (
      <>
        <Link href={`/inbox?candidate=${c.id}`} className="btn btn-primary">Start a Conversation</Link>
        <Link href={`/hire/${c.id}/offer`} className="btn btn-lime">Hire Directly</Link>
      </>
    )
  ) : null;

  const body = loading ? (
    <div className="pv-spinner" />
  ) : failed ? (
    <p className="pv-hint" style={{ textAlign: "center", padding: "40px 0" }}>
      Couldn&apos;t load this preview — something went wrong on our side. Close it and try again.
    </p>
  ) : c ? (
    <>
      {/* Voice preview */}
      <div className="pv-section">
        <div className="pv-voice">
          <div className="pv-voice-row">
            <span className="pv-label" style={{ marginBottom: 0 }}>Voice preview</span>
            <button onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute" : "Mute"} style={{ color: "var(--ink-mute)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth={1.8} stroke="currentColor">
                {muted
                  ? <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                  : <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />}
              </svg>
            </button>
          </div>
          {data?.voicePreviewSignedUrl ? (
            <>
              <div className="pv-wave" aria-hidden>
                {Array.from({ length: 24 }).map((_, i) => (
                  <span key={i} style={{ height: `${25 + ((i * 37) % 70)}%`, animationDelay: `${i * 60}ms` }} />
                ))}
              </div>
              <p className="pv-hint">Hear {firstName} — every professional on StaffVA is voice verified.</p>
            </>
          ) : (
            <p className="pv-hint">Voice recording pending — this professional has not yet added their introduction.</p>
          )}
        </div>
      </div>

      {/* Quick facts */}
      <div className="pv-section">
        <div className="pv-facts">
          <span className="pv-rate">${c.hourly_rate}<span style={{ fontSize: "12px", color: "var(--ink-mute)" }}>/hr</span></span>
          {earningsLabel && <span className="pv-earned">{earningsLabel}</span>}
        </div>
      </div>

      {/* Screening results */}
      {scoreRows.length > 0 && (
        <div className="pv-section">
          <p className="pv-label">Screening results</p>
          {scoreRows.map((d) => (
            <div className="score-row" key={d.label}>
              <div className="score-label">{d.label}</div>
              <div className="score-bar"><div className="score-fill" style={{ width: `${Math.min(d.score, 100)}%` }}></div></div>
              <div className="score-val">{d.score}</div>
            </div>
          ))}
          <p className="pv-hint">These scores come from a real assessment. {firstName} completed a written English test and a structured skills interview before appearing on this platform.</p>
        </div>
      )}

      {/* Bio */}
      {c.bio && (
        <div className="pv-section">
          <p className="pv-label">About</p>
          <p className="pv-bio" style={bioExpanded ? undefined : { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c.bio}</p>
          {c.bio.length > 200 && !bioExpanded && (
            <button className="pv-more" onClick={() => setExpandedForId(candidateId)}>Show more</button>
          )}
        </div>
      )}

      {/* Skills */}
      {skills.length > 0 && (
        <div className="pv-section">
          <p className="pv-label">Skills</p>
          <div className="filter-chips">
            {skills.map((s) => (
              <button key={s} className="filter-chip" onClick={() => onSkillClick?.(s)}>{s}</button>
            ))}
          </div>
        </div>
      )}

      {/* Review */}
      {data?.review && (
        <div className="pv-section">
          <p className="pv-label">Client feedback</p>
          <div className="pv-review">
            <div className="pv-stars">{"★".repeat(data.review.rating)}{"☆".repeat(5 - data.review.rating)}</div>
            {data.review.body && <p className="pv-review-body">{data.review.body}</p>}
            <p className="pv-review-meta">
              {data.review.clientName?.split(" ")[0] || "Client"} · {new Date(data.review.submitted_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })} · every review requires a completed escrow payment
            </p>
            {data.reviewCount > 1 && (
              <Link href={`/candidate/${c.id}`} target="_blank" className="pv-more" style={{ display: "inline-block", marginTop: "6px" }}>See all {data.reviewCount} reviews</Link>
            )}
          </div>
        </div>
      )}

      {/* Work experience */}
      {workExp.length > 0 && (
        <div className="pv-section">
          <p className="pv-label">Experience</p>
          {workExp.map((e, i) => (
            <div className="pv-exp-item" key={i}>
              <p className="pv-exp-title">{e.company_name ? `${e.company_name} · ${e.role_title}` : e.role_title}</p>
              <p className="pv-exp-meta">{[e.industry, e.duration].filter(Boolean).join(" · ")}</p>
              {e.description && <p className="pv-exp-desc">{e.description}</p>}
            </div>
          ))}
          <Link href={`/candidate/${c.id}`} target="_blank" className="pv-more" style={{ display: "inline-block" }}>See full profile</Link>
        </div>
      )}
    </>
  ) : null;

  return (
    <div className={`pv-panel ${candidateId ? "" : ""}`}>
      {/* Header */}
      <div className={`pv-head pv-fade ${fade ? "faded" : ""}`}>
        <div className="pv-head-row">
          <button className="pv-close" onClick={onClose} aria-label="Close preview">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          {c && (
            <Link href={`/candidate/${c.id}`} target="_blank" className="pv-full-link">
              View full profile
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-4.5-6H18m0 0v4.5m0-4.5L10.5 13.5" /></svg>
            </Link>
          )}
        </div>

        {c && !loading && (
          <>
            <div className="pv-identity">
              <div className="pv-photo" style={c.profile_photo_url ? { backgroundImage: `url(${c.profile_photo_url})` } : undefined}>
                {c.profile_photo_url ? "" : firstName[0]}
                <span className="pv-avail-dot" style={{ background: availColor }} />
              </div>
              <h2 className="pv-name">
                {c.display_name}
                <span className="result-verify"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><polyline points="20 6 9 17 4 12" /></svg></span>
              </h2>
              <p className="pv-role">{c.tagline || c.role_category}</p>
              <p className="pv-meta">{c.country}{localTime ? ` · ${localTime} local` : ""}</p>
            </div>
            <div className="pv-ctas">{ctas}</div>
          </>
        )}
      </div>

      {/* Scrollable body */}
      <div className={`pv-body pv-fade ${fade ? "faded" : ""}`}>{body}</div>
    </div>
  );
}
