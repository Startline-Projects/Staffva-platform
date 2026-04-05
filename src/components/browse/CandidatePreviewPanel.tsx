"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

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
    work_experience: { role_title: string; industry: string; duration: string; description: string; start_date?: string; end_date?: string }[] | null;
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
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [fade, setFade] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [muted, setMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!candidateId) return;

    // Fade transition when switching candidates
    if (prevIdRef.current && prevIdRef.current !== candidateId) {
      setFade(true);
      setTimeout(() => setFade(false), 150);
    }
    prevIdRef.current = candidateId;

    setLoading(true);
    setBioExpanded(false);

    fetch(`/api/candidates/preview?id=${candidateId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.candidate) {
          setData(d);
          // Auto-play voice preview
          if (d.voicePreviewSignedUrl) {
            // Stop any existing audio
            if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
            // Dispatch global stop event
            window.dispatchEvent(new CustomEvent("staffva-stop-audio"));
            const audio = new Audio(d.voicePreviewSignedUrl);
            audio.volume = muted ? 0 : 1;
            audioRef.current = audio;
            audio.play().catch(() => {}); // Browser may block
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));

    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
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

  const c = data?.candidate;
  const firstName = c?.first_name || c?.display_name?.split(" ")[0] || "Professional";
  const localTime = (() => {
    try { return new Date().toLocaleTimeString("en-US", { timeZone: c?.time_zone || "UTC", hour: "numeric", minute: "2-digit" }); } catch { return ""; }
  })();
  const availDot = !c?.committed_hours || c.committed_hours === 0 ? "bg-green-500" : c.committed_hours < 40 ? "bg-amber-500" : "bg-gray-300";
  const earningsLabel = (c?.total_earnings_usd || 0) >= 10000 ? "$10K+" : (c?.total_earnings_usd || 0) >= 1000 ? `$${Math.floor((c?.total_earnings_usd || 0) / 1000)}K+` : null;
  const skills = [...(c?.skills || []), ...(c?.tools || [])];
  const workExp = (c?.work_experience || []).slice(0, 2);

  return (
    <>
      {/* Desktop panel */}
      <div className={`hidden md:flex flex-col fixed top-0 right-0 h-full w-[480px] bg-white border-l border-gray-200 shadow-xl z-40 transition-transform duration-250 ease-out ${candidateId ? "translate-x-0" : "translate-x-full"}`}>
        {/* Sticky header */}
        <div className={`shrink-0 p-5 border-b border-gray-100 transition-opacity duration-150 ${fade ? "opacity-0" : "opacity-100"}`}>
          <div className="flex items-start justify-between">
            <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            {c && (
              <Link href={`/candidate/${c.id}`} target="_blank" className="text-xs text-[#FE6E3E] hover:underline flex items-center gap-1">
                View Full Profile
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-4.5-6H18m0 0v4.5m0-4.5L10.5 13.5" /></svg>
              </Link>
            )}
          </div>

          {c && !loading && (
            <>
              {/* Photo + name */}
              <div className="flex flex-col items-center mt-3">
                <div className="relative">
                  <div className="h-[72px] w-[72px] overflow-hidden rounded-full bg-gray-100">
                    {c.profile_photo_url ? <img src={c.profile_photo_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-gray-400">{firstName[0]}</div>}
                  </div>
                  <span className={`absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-white ${availDot}`} />
                </div>
                <h2 className="mt-2 text-lg font-semibold text-[#1C1B1A]">{c.display_name}</h2>
                <p className="text-xs text-text-secondary">{c.role_category}</p>
                <p className="text-[11px] text-text-tertiary">{c.country}{localTime ? ` · ${localTime}` : ""}</p>
              </div>

              {/* Action buttons */}
              <div className="mt-4 space-y-2">
                {data?.relationship === "engaged" ? (
                  <>
                    <Link href={`/hire/${c.id}/offer`} className="block w-full rounded-lg bg-[#FE6E3E] py-2.5 text-center text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors">Hire Again</Link>
                    <Link href="/team" className="block w-full rounded-lg border-2 border-[#1C1B1A] py-2.5 text-center text-sm font-semibold text-[#1C1B1A] hover:bg-gray-50 transition-colors">View Engagement</Link>
                  </>
                ) : data?.relationship === "messaged" ? (
                  <>
                    <Link href={`/inbox?candidate=${c.id}`} className="block w-full rounded-lg bg-[#FE6E3E] py-2.5 text-center text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors">Continue Conversation</Link>
                    <Link href={`/hire/${c.id}/offer`} className="block w-full rounded-lg border-2 border-[#1C1B1A] py-2.5 text-center text-sm font-semibold text-[#1C1B1A] hover:bg-gray-50 transition-colors">Hire Now</Link>
                  </>
                ) : (
                  <>
                    <Link href={`/inbox?candidate=${c.id}`} className="block w-full rounded-lg bg-[#FE6E3E] py-2.5 text-center text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors">Start a Conversation</Link>
                    <Link href={`/hire/${c.id}/offer`} className="block w-full rounded-lg border-2 border-[#1C1B1A] py-2.5 text-center text-sm font-semibold text-[#1C1B1A] hover:bg-gray-50 transition-colors">Hire Directly</Link>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Scrollable content */}
        <div className={`flex-1 overflow-y-auto p-5 space-y-5 transition-opacity duration-150 ${fade ? "opacity-0" : "opacity-100"}`}>
          {loading ? (
            <div className="flex items-center justify-center py-12"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" /></div>
          ) : c ? (
            <>
              {/* Voice section */}
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase">Voice Preview</p>
                  <button onClick={() => setMuted(!muted)} className="text-gray-400 hover:text-gray-600">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      {muted ? <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" /> : <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />}
                    </svg>
                  </button>
                </div>
                {data?.voicePreviewSignedUrl ? (
                  <>
                    <div className="flex items-end gap-0.5 h-8">
                      {Array.from({ length: 24 }).map((_, i) => (
                        <div key={i} className="flex-1 rounded-sm bg-[#FE6E3E]/60 animate-pulse" style={{ height: `${20 + Math.random() * 80}%`, animationDelay: `${i * 50}ms` }} />
                      ))}
                    </div>
                    <p className="mt-2 text-[10px] text-gray-400 italic">Hear {firstName} — every professional on StaffVA is voice verified.</p>
                  </>
                ) : (
                  <p className="text-[10px] text-gray-400 italic">Voice recording pending — this professional has not yet added their introduction.</p>
                )}
              </div>

              {/* Trust signals */}
              <div className="flex items-center gap-1.5 text-xs overflow-x-auto">
                <span className="shrink-0 font-semibold text-[#FE6E3E]">${c.hourly_rate}/hr</span>
                {c.reputation_score && c.reputation_score > 0 && <><span className="text-gray-300">&middot;</span><span className="shrink-0 text-text-secondary">{c.reputation_score}%</span></>}
                {earningsLabel && <><span className="text-gray-300">&middot;</span><span className="shrink-0 text-green-600">{earningsLabel} earned</span></>}
              </div>

              {/* AI Assessment */}
              {data?.aiInterview && data.aiInterview.passed && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase mb-2">AI Assessment Results</p>
                  <div className="space-y-2">
                    {[
                      { label: "Technical Knowledge", score: Math.round(data.aiInterview.technical_knowledge_score * 5) },
                      { label: "Communication", score: Math.round(data.aiInterview.communication_score * 5) },
                      { label: "Problem Solving", score: Math.round(data.aiInterview.problem_solving_score * 5) },
                      { label: "Experience Depth", score: Math.round(data.aiInterview.experience_depth_score * 5) },
                      { label: "Professionalism", score: Math.round(data.aiInterview.professionalism_score * 5) },
                    ].map((d) => (
                      <div key={d.label}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px] text-text-secondary">{d.label}</span>
                          <span className="text-[10px] font-semibold text-[#1C1B1A] tabular-nums">{d.score}/100</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-100"><div className="h-1.5 rounded-full bg-[#FE6E3E]" style={{ width: `${Math.min(d.score, 100)}%` }} /></div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[9px] text-gray-400 italic">These scores come from a real assessment. {firstName} completed a written English test and a full AI interview before appearing on this platform.</p>
                </div>
              )}

              {/* Bio */}
              {c.bio && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">About</p>
                  <p className={`text-xs text-text-secondary leading-relaxed ${bioExpanded ? "" : "line-clamp-3"}`}>{c.bio}</p>
                  {c.bio.length > 200 && !bioExpanded && (
                    <button onClick={() => setBioExpanded(true)} className="text-[10px] text-[#FE6E3E] hover:underline mt-0.5">Show more</button>
                  )}
                </div>
              )}

              {/* Skills */}
              {skills.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Skills</p>
                  <div className="flex flex-wrap gap-1">
                    {skills.map((s) => (
                      <button key={s} onClick={() => onSkillClick?.(s)} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-text-secondary hover:bg-gray-200 transition-colors cursor-pointer">{s}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* Review */}
              {data?.review && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Client Feedback</p>
                  <div className="rounded-lg border border-gray-100 p-3">
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <svg key={s} className={`h-3.5 w-3.5 ${s <= data.review!.rating ? "text-amber-400" : "text-gray-200"}`} fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                      ))}
                    </div>
                    {data.review.body && <p className="mt-1 text-xs text-text-secondary line-clamp-3">{data.review.body}</p>}
                    <p className="mt-1 text-[9px] text-gray-400">
                      {data.review.clientName?.split(" ")[0] || "Client"} &middot; {new Date(data.review.submitted_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                    </p>
                    <p className="mt-1 text-[8px] text-gray-400 italic">Every review on StaffVA requires a completed escrow payment.</p>
                    {data.reviewCount > 1 && (
                      <Link href={`/candidate/${c.id}`} target="_blank" className="mt-1 block text-[10px] text-[#FE6E3E] hover:underline">See all {data.reviewCount} reviews</Link>
                    )}
                  </div>
                </div>
              )}

              {/* Work Experience */}
              {workExp.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Experience</p>
                  <div className="space-y-2">
                    {workExp.map((e, i) => (
                      <div key={i} className="rounded-lg bg-gray-50 p-2.5">
                        <p className="text-xs font-medium text-[#1C1B1A]">{e.role_title}</p>
                        <p className="text-[10px] text-gray-500">{e.industry} &middot; {e.duration}</p>
                        {e.description && <p className="mt-0.5 text-[10px] text-gray-500 line-clamp-1">{e.description}</p>}
                      </div>
                    ))}
                  </div>
                  <Link href={`/candidate/${c.id}`} target="_blank" className="mt-1 block text-[10px] text-[#FE6E3E] hover:underline">See full profile</Link>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>

      {/* Mobile full-screen panel */}
      {candidateId && (
        <div className={`md:hidden fixed inset-0 z-50 bg-white overflow-y-auto transition-transform duration-250 ease-out ${candidateId ? "translate-x-0" : "translate-x-full"}`}>
          {/* Sticky mobile header */}
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100">
            <button onClick={onClose} className="flex items-center gap-1 text-sm text-gray-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              Back
            </button>
            {c && <Link href={`/candidate/${c.id}`} target="_blank" className="text-xs text-[#FE6E3E]">Full Profile</Link>}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" /></div>
          ) : c ? (
            <div className="p-4 space-y-4">
              {/* Photo + name */}
              <div className="flex flex-col items-center">
                <div className="relative">
                  <div className="h-16 w-16 overflow-hidden rounded-full bg-gray-100">
                    {c.profile_photo_url ? <img src={c.profile_photo_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-xl font-bold text-gray-400">{firstName[0]}</div>}
                  </div>
                  <span className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white ${availDot}`} />
                </div>
                <h2 className="mt-2 text-lg font-semibold text-[#1C1B1A]">{c.display_name}</h2>
                <p className="text-xs text-text-secondary">{c.role_category}</p>
                <p className="text-[11px] text-text-tertiary">{c.country}</p>
              </div>

              {/* Action buttons */}
              <Link href={`/inbox?candidate=${c.id}`} className="block w-full rounded-lg bg-[#FE6E3E] py-3 text-center text-sm font-semibold text-white">
                {data?.relationship === "messaged" ? "Continue Conversation" : data?.relationship === "engaged" ? "Hire Again" : "Start a Conversation"}
              </Link>

              {/* Trust signals */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="font-semibold text-[#FE6E3E]">${c.hourly_rate}/hr</span>
                {c.reputation_score && c.reputation_score > 0 && <><span className="text-gray-300">&middot;</span><span className="text-text-secondary">{c.reputation_score}%</span></>}
              </div>

              {/* Bio */}
              {c.bio && <p className="text-xs text-text-secondary leading-relaxed line-clamp-3">{c.bio}</p>}

              {/* Skills */}
              {skills.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {skills.slice(0, 8).map((s) => (
                    <button key={s} onClick={() => { onSkillClick?.(s); onClose(); }} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-text-secondary">{s}</button>
                  ))}
                </div>
              )}

              <Link href={`/candidate/${c.id}`} className="block w-full rounded-lg border border-gray-200 py-2.5 text-center text-sm font-medium text-[#1C1B1A]">View Full Profile</Link>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
