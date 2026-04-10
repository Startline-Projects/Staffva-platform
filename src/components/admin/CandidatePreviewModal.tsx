"use client";

import { useState, useEffect } from "react";
import AudioPlayer from "@/components/AudioPlayer";

const TIER_CONFIG: Record<string, { label: string; bg: string }> = {
  exceptional: { label: "Exceptional", bg: "bg-emerald-600" },
  advanced: { label: "Advanced", bg: "bg-blue-600" },
  professional: { label: "Professional", bg: "bg-gray-500" },
};

const SPEAKING_CONFIG: Record<string, { label: string; bg: string }> = {
  fluent: { label: "Fluent", bg: "bg-emerald-600" },
  proficient: { label: "Proficient", bg: "bg-blue-600" },
  conversational: { label: "Conversational", bg: "bg-amber-600" },
  developing: { label: "Developing", bg: "bg-gray-500" },
};

const US_EXP_LABELS: Record<string, string> = {
  full_time: "Full-time US client experience",
  part_time_contract: "Part-time / contract US experience",
  international_only: "International client experience",
  none: "No prior US client experience",
};

interface Candidate {
  id: string;
  full_name: string;
  display_name: string;
  email: string;
  country: string;
  role_category: string;
  years_experience: string;
  hourly_rate: number;
  bio: string;
  tagline: string;
  profile_photo_url: string;
  tools: string[];
  work_experience: { company_name?: string; role_title: string; industry: string; duration: string; description: string }[];
  english_written_tier: string;
  speaking_level: string;
  us_client_experience: string;
  us_client_description: string;
  voice_recording_1_url: string;
  voice_recording_2_url: string;
  resume_url: string;
  payout_method: string;
  availability_status: string;
  total_earnings_usd: number;
  admin_status: string;
  time_zone?: string;
  linkedin_url?: string;
}

interface ReassignLogEntry {
  id: string;
  reassigned_at: string;
  from_name: string | null;
  to_name: string;
  reassigned_by_name: string;
  reason: string | null;
}

interface Props {
  candidate: Candidate;
  onClose: () => void;
  onAction: (candidateId: string, action: "approve" | "reject" | "revision_required") => void;
  speakingLevel: string;
  onSpeakingLevelChange: (level: string) => void;
  revisionNote: string;
  onRevisionNoteChange: (note: string) => void;
  actionLoading: boolean;
  showActions: boolean;
  token?: string;
}

export default function CandidatePreviewModal({
  candidate: c,
  onClose,
  onAction,
  speakingLevel,
  onSpeakingLevelChange,
  revisionNote,
  onRevisionNoteChange,
  actionLoading,
  showActions,
  token,
}: Props) {
  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [reassignLog, setReassignLog] = useState<ReassignLogEntry[]>([]);

  useEffect(() => {
    if (!token || !c?.id) return;
    fetch(`/api/admin/reassign/log?candidateId=${c.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.log) setReassignLog(data.log); })
      .catch(() => {});
  }, [token, c?.id]);

  const tier = c.english_written_tier ? TIER_CONFIG[c.english_written_tier] : null;
  const speaking = c.speaking_level ? SPEAKING_CONFIG[c.speaking_level] : null;
  const hasUSExperience = c.us_client_experience === "full_time" || c.us_client_experience === "part_time_contract";
  const tools: string[] = c.tools || [];
  const workExp = c.work_experience || [];

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative my-8 w-full max-w-4xl rounded-2xl bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl border-b border-gray-200 bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
              Profile Preview — Not Yet Live
            </span>
            <span className="text-sm text-text/50">{c.full_name}</span>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5 text-text/40" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ═══════════ PROFILE HEADER ═══════════ */}
        <div className="bg-[#1C1B1A] rounded-none">
          <div className="px-8 py-8">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
              <div className="flex items-start gap-5">
                <div className="flex-shrink-0 h-20 w-20 rounded-full overflow-hidden border-2 border-white/20 bg-white/10">
                  {c.profile_photo_url ? (
                    <img src={c.profile_photo_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <span className="text-3xl font-bold text-white/60">{c.display_name?.charAt(0) || c.full_name?.charAt(0) || "?"}</span>
                    </div>
                  )}
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white">{c.display_name || c.full_name}</h2>
                  <p className="text-sm text-white/40">Full name: {c.full_name}</p>
                  <p className="mt-0.5 text-white/50">{c.country}</p>
                  {c.tagline && <p className="mt-2 text-sm text-white/70">{c.tagline}</p>}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white">{c.role_category}</span>
                    {tier && (
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold text-white ${tier.bg}`}>
                        English: {tier.label}
                      </span>
                    )}
                    {speaking && (
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold text-white ${speaking.bg}`}>
                        Speaking: {speaking.label}
                      </span>
                    )}
                    {hasUSExperience && (
                      <span className="rounded-full bg-green-600 px-3 py-1 text-xs font-semibold text-white">US Experience</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-4xl font-bold text-primary">${c.hourly_rate?.toLocaleString()}</p>
                <p className="text-xs text-white/40 mt-1">per month</p>
                <div className="mt-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                    c.availability_status === "available_now"
                      ? "bg-green-500/20 text-green-400"
                      : c.availability_status === "available_by_date"
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-white/10 text-white/50"
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      c.availability_status === "available_now" ? "bg-green-400" : "bg-amber-400"
                    }`} />
                    {c.availability_status === "available_now" ? "Available Now" : c.availability_status === "available_by_date" ? "Available by date" : "Not Available"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════ AUDIO PLAYERS ═══════════ */}
        <div className="px-8 -mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AudioPlayer storagePath={c.voice_recording_1_url} label="Oral Reading Assessment" />
            <AudioPlayer storagePath={c.voice_recording_2_url} label="Professional Introduction" />
          </div>
        </div>

        {/* ═══════════ MAIN CONTENT ═══════════ */}
        <div className="px-8 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left 2/3 */}
            <div className="lg:col-span-2 space-y-6">
              {c.bio && (
                <div className="rounded-xl border border-gray-200 bg-white p-6">
                  <h3 className="text-sm font-semibold text-text/40 uppercase tracking-wider">About</h3>
                  <p className="mt-3 text-sm leading-relaxed text-text/80">{c.bio}</p>
                </div>
              )}

              {tools.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white p-6">
                  <h3 className="text-sm font-semibold text-text/40 uppercase tracking-wider">Tools & Software</h3>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {tools.map((tool: string) => (
                      <span key={tool} className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {workExp.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white p-6">
                  <h3 className="text-sm font-semibold text-text/40 uppercase tracking-wider">Work Experience</h3>
                  <div className="mt-4 space-y-5">
                    {workExp.map((entry, i) => (
                      <div key={i} className="relative pl-6 border-l-2 border-primary/20">
                        <div className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-primary" />
                        <p className="font-semibold text-text text-sm">{entry.company_name ? `${entry.company_name} · ${entry.role_title}` : entry.role_title}</p>
                        <p className="text-xs text-text/50 mt-0.5">{entry.industry} &middot; {entry.duration}</p>
                        {entry.description && <p className="mt-1 text-sm text-text/70">{entry.description}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h3 className="text-sm font-semibold text-text/40 uppercase tracking-wider">Details</h3>
                <div className="mt-4 grid grid-cols-2 gap-y-4 gap-x-8">
                  <div>
                    <p className="text-xs text-text/40">Experience</p>
                    <p className="mt-0.5 text-sm font-medium text-text">{c.years_experience}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text/40">US Client Experience</p>
                    <p className="mt-0.5 text-sm font-medium text-text">{US_EXP_LABELS[c.us_client_experience] || "Not specified"}</p>
                  </div>
                  {c.us_client_description && (
                    <div className="col-span-2">
                      <p className="text-xs text-text/40">US Work Description</p>
                      <p className="mt-0.5 text-sm text-text/70">{c.us_client_description}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-text/40">Email</p>
                    <p className="mt-0.5 text-sm font-medium text-text">{c.email}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text/40">Payout Method</p>
                    <p className="mt-0.5 text-sm font-medium text-text capitalize">{c.payout_method?.replace(/_/g, " ") || "Not set"}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right 1/3 */}
            <div className="lg:col-span-1 space-y-4">
              <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-3">
                <p className="text-center text-2xl font-bold text-primary">
                  ${c.hourly_rate?.toLocaleString()}<span className="text-sm font-normal text-text/40">/hr</span>
                </p>
                {Number(c.total_earnings_usd) > 0 && (
                  <>
                    <div className="border-t border-gray-100" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text/40">Verified Earnings</span>
                      <span className="text-sm font-semibold text-green-600">${Number(c.total_earnings_usd).toLocaleString()}</span>
                    </div>
                  </>
                )}
                {hasUSExperience && (
                  <>
                    <div className="border-t border-gray-100" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text/40">US Experience</span>
                      <span className="text-xs font-medium text-green-600">
                        {c.us_client_experience === "full_time" ? "Full-time" : "Part-time/Contract"}
                      </span>
                    </div>
                  </>
                )}
                {c.resume_url && (
                  <>
                    <div className="border-t border-gray-100" />
                    <a href={c.resume_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary hover:text-orange-600">
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">PDF</span>
                      Download Resume
                    </a>
                  </>
                )}
              </div>

              <div className="rounded-xl bg-gray-50 p-5 space-y-3">
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <p className="text-xs text-text/60">English proficiency locked by StaffVA</p>
                </div>
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <p className="text-xs text-text/60">Speaking level verified by human reviewer</p>
                </div>
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <p className="text-xs text-text/60">Payments protected by escrow</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════ ACTION BAR ═══════════ */}
        {showActions && (
          <div className="sticky bottom-0 rounded-b-2xl border-t border-gray-200 bg-white px-8 py-4">
            <div className="space-y-3">
              <div className="flex items-end gap-3 flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-xs font-medium text-text/60 mb-1">Speaking Level</label>
                  <select
                    value={speakingLevel}
                    onChange={(e) => onSpeakingLevelChange(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
                  >
                    <option value="">Select level...</option>
                    <option value="fluent">Fluent</option>
                    <option value="proficient">Proficient</option>
                    <option value="conversational">Conversational</option>
                    <option value="developing">Developing</option>
                  </select>
                </div>
                <button
                  onClick={() => onAction(c.id, "approve")}
                  disabled={actionLoading || !speakingLevel}
                  className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {actionLoading ? "..." : "Approve"}
                </button>
                <button
                  onClick={() => setShowRevisionForm(!showRevisionForm)}
                  className="rounded-lg bg-amber-500 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-600 transition-colors"
                >
                  Revision Required
                </button>
                <button
                  onClick={() => onAction(c.id, "reject")}
                  disabled={actionLoading}
                  className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  Reject
                </button>
              </div>

              {showRevisionForm && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <textarea
                    value={revisionNote}
                    onChange={(e) => onRevisionNoteChange(e.target.value)}
                    placeholder="Describe what the candidate needs to update..."
                    rows={3}
                    className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-text placeholder-text/40 focus:border-amber-500 focus:outline-none resize-none"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      onClick={() => setShowRevisionForm(false)}
                      className="rounded-lg border border-amber-300 px-4 py-1.5 text-sm text-amber-700 hover:bg-amber-100 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => onAction(c.id, "revision_required")}
                      disabled={actionLoading || !revisionNote?.trim()}
                      className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
                    >
                      {actionLoading ? "Sending..." : "Send & Hold"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reassignment History */}
        {reassignLog.length > 0 && (
          <div className="px-6 pb-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Reassignment History</h3>
            <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {reassignLog.map((entry) => (
                <div key={entry.id} className="px-4 py-3 flex items-start gap-3">
                  <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#FE6E3E]" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#1C1B1A]">
                      {entry.from_name ? (
                        <><span className="font-medium">{entry.from_name}</span> → <span className="font-medium">{entry.to_name}</span></>
                      ) : (
                        <>Assigned to <span className="font-medium">{entry.to_name}</span></>
                      )}
                    </p>
                    {entry.reason && <p className="mt-0.5 text-[11px] text-gray-500 italic">{entry.reason}</p>}
                    <p className="mt-0.5 text-[10px] text-gray-400">
                      by {entry.reassigned_by_name} &middot; {new Date(entry.reassigned_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
