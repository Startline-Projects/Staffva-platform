"use client";

import { useState, useEffect } from "react";
import AudioPlayer from "@/components/AudioPlayer";

const TIER_LABELS: Record<string, string> = {
  exceptional: "Exceptional",
  proficient: "Proficient",
  competent: "Competent",
};

const SPEAKING_LABELS: Record<string, string> = {
  fluent: "Fluent",
  proficient: "Proficient",
  conversational: "Conversational",
  basic: "Basic",
};

const US_EXP_LABELS: Record<string, string> = {
  full_time: "Yes, full time",
  part_time_contract: "Yes, part time or contract",
  international_only: "International only",
  none: "First international role",
};

interface TestEvent {
  event_type: string;
  question_number: number;
  created_at: string;
}

interface Candidate {
  id: string;
  full_name: string;
  display_name: string;
  email: string;
  country: string;
  role_category: string;
  years_experience: string;
  monthly_rate: number;
  bio: string;
  tagline: string;
  profile_photo_url: string;
  tools: string[];
  work_experience: { role_title: string; industry: string; duration: string; description: string }[];
  english_mc_score: number;
  english_comprehension_score: number;
  english_percentile: number;
  english_written_tier: string;
  speaking_level: string;
  cheat_flag_count: number;
  score_mismatch_flag: boolean;
  id_verification_status: string;
  us_client_experience: string;
  us_client_description: string;
  voice_recording_1_url: string;
  voice_recording_2_url: string;
  resume_url: string;
  payout_method: string;
  availability_status: string;
  total_earnings_usd: number;
  screening_tag: string | null;
  screening_score: number | null;
  screening_reason: string | null;
  admin_status: string;
  created_at: string;
  profile_completed_at: string;
  test_events: TestEvent[];
}

const SCREENING_BADGE: Record<string, { label: string; color: string }> = {
  Priority: { label: "Priority", color: "bg-green-100 text-green-700" },
  Review: { label: "Review", color: "bg-amber-100 text-amber-700" },
  Hold: { label: "Hold", color: "bg-gray-200 text-gray-600" },
};

export default function CandidateReviewPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending_speaking_review");
  const [screeningFilter, setScreeningFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [speakingLevels, setSpeakingLevels] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Record<string, string>>({});
  const [revisionNotes, setRevisionNotes] = useState<Record<string, string>>({});
  const [showRevisionForm, setShowRevisionForm] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadCandidates();
  }, [filter]);

  async function loadCandidates() {
    setLoading(true);
    const res = await fetch(`/api/admin/candidates?status=${filter}`);
    const data = await res.json();
    setCandidates(data.candidates || []);
    setLoading(false);
  }

  async function handleAction(
    candidateId: string,
    action: "approve" | "reject" | "flag" | "revision_required"
  ) {
    if (action === "approve" && !speakingLevels[candidateId]) {
      alert("Please select a speaking level before approving.");
      return;
    }

    if (action === "revision_required" && (!revisionNotes[candidateId] || revisionNotes[candidateId].trim().length === 0)) {
      alert("Please write a revision note before sending.");
      return;
    }

    setActionLoading(candidateId);

    await fetch("/api/admin/candidates/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateId,
        action,
        speakingLevel: speakingLevels[candidateId] || null,
        revisionNote: revisionNotes[candidateId] || null,
      }),
    });

    setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
    setActionLoading(null);
    setShowRevisionForm((prev) => ({ ...prev, [candidateId]: false }));
  }

  const eventTypeCounts = (events: TestEvent[]) => {
    const counts: Record<string, number> = {};
    for (const e of events) {
      counts[e.event_type] = (counts[e.event_type] || 0) + 1;
    }
    return counts;
  };

  function getTab(id: string) {
    return activeTab[id] || "overview";
  }

  function setTab(id: string, tab: string) {
    setActiveTab((prev) => ({ ...prev, [id]: tab }));
  }

  const filteredCandidates = candidates
    .filter((c) => {
      if (screeningFilter === "all") return true;
      return c.screening_tag === screeningFilter;
    })
    .sort((a, b) => {
      const order: Record<string, number> = { Priority: 0, Review: 1, Hold: 2 };
      const aOrder = order[a.screening_tag || "Review"] ?? 1;
      const bOrder = order[b.screening_tag || "Review"] ?? 1;
      return aOrder - bOrder;
    });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text">Candidate Review Queue</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
        >
          <option value="pending_speaking_review">Pending Review</option>
          <option value="revision_required">Revision Required</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Screening filter pills */}
      <div className="mt-4 flex gap-2">
        {["all", "Priority", "Review", "Hold"].map((tag) => (
          <button
            key={tag}
            onClick={() => setScreeningFilter(tag)}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              screeningFilter === tag
                ? "bg-primary text-white"
                : "bg-gray-100 text-text/60 hover:bg-gray-200"
            }`}
          >
            {tag === "all" ? "All" : tag}
            {tag !== "all" && (
              <span className="ml-1.5 text-[10px] opacity-70">
                {candidates.filter((c) => c.screening_tag === tag).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-8 text-text/60">Loading candidates...</p>
      ) : filteredCandidates.length === 0 ? (
        <p className="mt-8 text-text/60">No candidates in this queue.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {filteredCandidates.map((c) => {
            const isExpanded = expandedId === c.id;
            const cheatCounts = eventTypeCounts(c.test_events || []);
            const tab = getTab(c.id);
            const tools: string[] = c.tools || [];
            const workExp = c.work_experience || [];

            return (
              <div
                key={c.id}
                className="rounded-xl border border-gray-200 bg-card overflow-hidden"
              >
                {/* Summary row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                  className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-gray-50"
                >
                  <div className="flex items-center gap-4">
                    {/* Photo */}
                    <div className="h-10 w-10 flex-shrink-0 rounded-full overflow-hidden bg-gray-100">
                      {c.profile_photo_url ? (
                        <img src={c.profile_photo_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm font-bold text-text/30">
                          {c.full_name?.charAt(0)}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="font-semibold text-text">
                        {c.full_name}
                        {c.screening_tag && SCREENING_BADGE[c.screening_tag] && (
                          <span className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${SCREENING_BADGE[c.screening_tag].color}`}>
                            {SCREENING_BADGE[c.screening_tag].label}
                            {c.screening_score && <span className="ml-1 opacity-70">{c.screening_score}/10</span>}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-text/60">
                        {c.country} &middot; {c.role_category} &middot; ${c.monthly_rate}/mo
                        {c.tagline && <span className="ml-1 text-text/40">&middot; {c.tagline}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.score_mismatch_flag && (
                      <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                        Mismatch
                      </span>
                    )}
                    {c.cheat_flag_count > 0 && (
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                        {c.cheat_flag_count} flags
                      </span>
                    )}
                    {c.english_written_tier && (
                      <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                        {TIER_LABELS[c.english_written_tier]}
                      </span>
                    )}
                    {c.speaking_level && (
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                        {SPEAKING_LABELS[c.speaking_level]}
                      </span>
                    )}
                    <svg
                      className={`h-5 w-5 text-text/40 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </div>
                </button>

                {/* Expanded detail panel */}
                {isExpanded && (
                  <div className="border-t border-gray-200">
                    {/* Tabs */}
                    <div className="flex border-b border-gray-200 px-6">
                      {["overview", "recordings", "profile", "test"].map((t) => (
                        <button
                          key={t}
                          onClick={() => setTab(c.id, t)}
                          className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider transition-colors ${
                            tab === t
                              ? "border-b-2 border-primary text-primary"
                              : "text-text/40 hover:text-text/70"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>

                    <div className="px-6 py-5">
                      {/* ── OVERVIEW TAB ── */}
                      {tab === "overview" && (
                        <div className="space-y-5">
                          {/* AI Screening */}
                          {c.screening_tag && (
                            <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                              <p className="text-xs font-semibold text-text/40 uppercase tracking-wider">AI Screening</p>
                              <p className="mt-1 text-sm text-text/80">{c.screening_reason}</p>
                            </div>
                          )}

                          {/* Score cards */}
                          <div className="grid grid-cols-4 gap-3">
                            <div className="rounded-lg bg-gray-50 p-3 text-center">
                              <p className="text-xs text-text/40">Grammar</p>
                              <p className="text-xl font-bold text-text">{c.english_mc_score ?? "—"}%</p>
                            </div>
                            <div className="rounded-lg bg-gray-50 p-3 text-center">
                              <p className="text-xs text-text/40">Comprehension</p>
                              <p className="text-xl font-bold text-text">{c.english_comprehension_score ?? "—"}%</p>
                            </div>
                            <div className="rounded-lg bg-gray-50 p-3 text-center">
                              <p className="text-xs text-text/40">Combined</p>
                              <p className="text-xl font-bold text-text">{c.english_percentile ?? "—"}%</p>
                            </div>
                            <div className="rounded-lg bg-gray-50 p-3 text-center">
                              <p className="text-xs text-text/40">Written Tier</p>
                              <p className="text-lg font-bold text-blue-600">{TIER_LABELS[c.english_written_tier] || "—"}</p>
                            </div>
                          </div>

                          {/* Key details */}
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-xs text-text/40">Email</p>
                              <p className="text-text">{c.email}</p>
                            </div>
                            <div>
                              <p className="text-xs text-text/40">Experience</p>
                              <p className="text-text">{c.years_experience} years</p>
                            </div>
                            <div>
                              <p className="text-xs text-text/40">US Client Experience</p>
                              <p className="text-text">{US_EXP_LABELS[c.us_client_experience] || "N/A"}</p>
                            </div>
                            <div>
                              <p className="text-xs text-text/40">Availability</p>
                              <p className="text-text capitalize">{c.availability_status?.replace(/_/g, " ") || "—"}</p>
                            </div>
                            {c.us_client_description && (
                              <div className="col-span-2">
                                <p className="text-xs text-text/40">US Work Description</p>
                                <p className="text-text">{c.us_client_description}</p>
                              </div>
                            )}
                            <div className="col-span-2">
                              <p className="text-xs text-text/40">Bio</p>
                              <p className="text-text">{c.bio || "—"}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── RECORDINGS TAB ── */}
                      {tab === "recordings" && (
                        <div className="space-y-5">
                          <div className="grid grid-cols-2 gap-4">
                            <AudioPlayer
                              storagePath={c.voice_recording_1_url}
                              label="Oral Reading"
                            />
                            <AudioPlayer
                              storagePath={c.voice_recording_2_url}
                              label="Self Introduction"
                            />
                          </div>

                          {/* Speaking level selector + actions */}
                          {(filter === "pending_speaking_review" || filter === "revision_required") && (
                            <div className="space-y-4">
                              <div className="rounded-lg border border-primary/20 bg-primary/5 p-5">
                                <p className="text-sm font-semibold text-text mb-3">
                                  Assign Speaking Level & Review
                                </p>
                                <div className="flex items-end gap-3 flex-wrap">
                                  <div className="flex-1 min-w-[180px]">
                                    <label className="block text-xs font-medium text-text/60 mb-1">
                                      Speaking Level (required for approval)
                                    </label>
                                    <select
                                      value={speakingLevels[c.id] || ""}
                                      onChange={(e) =>
                                        setSpeakingLevels((prev) => ({ ...prev, [c.id]: e.target.value }))
                                      }
                                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-text focus:border-primary focus:outline-none"
                                    >
                                      <option value="">Select level...</option>
                                      <option value="fluent">Fluent</option>
                                      <option value="proficient">Proficient</option>
                                      <option value="conversational">Conversational</option>
                                      <option value="basic">Basic</option>
                                    </select>
                                  </div>
                                  <button
                                    onClick={() => handleAction(c.id, "approve")}
                                    disabled={actionLoading === c.id || !speakingLevels[c.id]}
                                    className="rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                                  >
                                    {actionLoading === c.id ? "..." : "Approve"}
                                  </button>
                                  <button
                                    onClick={() => setShowRevisionForm((prev) => ({ ...prev, [c.id]: !prev[c.id] }))}
                                    className="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 transition-colors"
                                  >
                                    Revision Required
                                  </button>
                                  <button
                                    onClick={() => handleAction(c.id, "reject")}
                                    disabled={actionLoading === c.id}
                                    className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                                  >
                                    Reject
                                  </button>
                                </div>
                              </div>

                              {/* Revision form */}
                              {showRevisionForm[c.id] && (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
                                  <p className="text-sm font-semibold text-amber-900 mb-2">
                                    Send Revision Request
                                  </p>
                                  <textarea
                                    value={revisionNotes[c.id] || ""}
                                    onChange={(e) =>
                                      setRevisionNotes((prev) => ({ ...prev, [c.id]: e.target.value }))
                                    }
                                    placeholder="Describe what the candidate needs to update before their profile can be approved..."
                                    rows={4}
                                    className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2.5 text-sm text-text placeholder-text/40 focus:border-amber-500 focus:outline-none resize-none"
                                  />
                                  <div className="mt-3 flex items-center justify-between">
                                    <p className="text-xs text-amber-700">
                                      This will be emailed to {c.email}
                                    </p>
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => setShowRevisionForm((prev) => ({ ...prev, [c.id]: false }))}
                                        className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => handleAction(c.id, "revision_required")}
                                        disabled={actionLoading === c.id || !revisionNotes[c.id]?.trim()}
                                        className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
                                      >
                                        {actionLoading === c.id ? "Sending..." : "Send & Hold"}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── PROFILE TAB ── */}
                      {tab === "profile" && (
                        <div className="space-y-5">
                          {/* Tools */}
                          {tools.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-2">
                                Tools & Software ({tools.length})
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {tools.map((tool) => (
                                  <span key={tool} className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
                                    {tool}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Work Experience */}
                          {workExp.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-2">
                                Work Experience ({workExp.length})
                              </p>
                              <div className="space-y-3">
                                {workExp.map((entry, i) => (
                                  <div key={i} className="rounded-lg bg-gray-50 p-3">
                                    <p className="font-medium text-sm text-text">{entry.role_title}</p>
                                    <p className="text-xs text-text/50">{entry.industry} &middot; {entry.duration}</p>
                                    {entry.description && <p className="mt-1 text-xs text-text/70">{entry.description}</p>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Resume + Payout */}
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-1">Resume</p>
                              {c.resume_url ? (
                                <a href={c.resume_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-primary hover:text-orange-600">
                                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">PDF</span>
                                  Download Resume
                                </a>
                              ) : (
                                <p className="text-xs text-text/40 italic">Not uploaded</p>
                              )}
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-1">Payout Method</p>
                              <p className="text-sm text-text capitalize">{c.payout_method?.replace(/_/g, " ") || "—"}</p>
                            </div>
                          </div>

                          {/* Applied / Profile completed timestamps */}
                          <div className="grid grid-cols-2 gap-4 text-xs text-text/40">
                            <div>
                              Applied: {c.created_at ? new Date(c.created_at).toLocaleDateString() : "—"}
                            </div>
                            <div>
                              Profile completed: {c.profile_completed_at ? new Date(c.profile_completed_at).toLocaleDateString() : "—"}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── TEST TAB ── */}
                      {tab === "test" && (
                        <div className="space-y-5">
                          {/* Score breakdown */}
                          <div className="grid grid-cols-3 gap-4">
                            <div className="rounded-lg bg-gray-50 p-4 text-center">
                              <p className="text-xs text-text/40">Grammar Score</p>
                              <p className="text-2xl font-bold text-text">{c.english_mc_score ?? "—"}%</p>
                            </div>
                            <div className="rounded-lg bg-gray-50 p-4 text-center">
                              <p className="text-xs text-text/40">Comprehension Score</p>
                              <p className="text-2xl font-bold text-text">{c.english_comprehension_score ?? "—"}%</p>
                            </div>
                            <div className="rounded-lg bg-gray-50 p-4 text-center">
                              <p className="text-xs text-text/40">Assigned Tier</p>
                              <p className="text-xl font-bold text-blue-600">{TIER_LABELS[c.english_written_tier] || "—"}</p>
                            </div>
                          </div>

                          {/* Flags */}
                          <div className="grid grid-cols-2 gap-4">
                            <div className="rounded-lg border p-3 text-center">
                              <p className="text-xs text-text/40">Score Mismatch</p>
                              <p className={`text-sm font-semibold ${c.score_mismatch_flag ? "text-red-600" : "text-green-600"}`}>
                                {c.score_mismatch_flag ? "FLAGGED" : "Clean"}
                              </p>
                            </div>
                            <div className="rounded-lg border p-3 text-center">
                              <p className="text-xs text-text/40">Cheat Flags</p>
                              <p className={`text-sm font-semibold ${c.cheat_flag_count > 0 ? "text-amber-600" : "text-green-600"}`}>
                                {c.cheat_flag_count} events
                              </p>
                            </div>
                          </div>

                          {/* Cheat event breakdown */}
                          {(c.test_events || []).length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-2">
                                Cheat Event Log ({c.test_events.length} events)
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {Object.entries(cheatCounts).map(([type, count]) => (
                                  <span key={type} className="rounded bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs text-amber-700">
                                    {type.replace(/_/g, " ")}: {count}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* ID verification */}
                          <div>
                            <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-1">ID Verification</p>
                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                              c.id_verification_status === "passed" ? "bg-green-100 text-green-700" :
                              c.id_verification_status === "failed" ? "bg-red-100 text-red-700" :
                              c.id_verification_status === "manual_review" ? "bg-amber-100 text-amber-700" :
                              "bg-gray-100 text-gray-600"
                            }`}>
                              {c.id_verification_status?.replace(/_/g, " ") || "Pending"}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
