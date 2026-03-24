"use client";

import { useState, useEffect, useCallback } from "react";
import AudioPlayer from "@/components/AudioPlayer";
import CandidatePreviewModal from "@/components/admin/CandidatePreviewModal";
import InterviewPanel from "@/components/admin/InterviewPanel";
import PhotoReviewModal from "@/components/admin/PhotoReviewModal";

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

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  pending_speaking_review: { label: "Pending Review", color: "bg-amber-100 text-amber-700" },
  approved: { label: "Approved", color: "bg-green-100 text-green-700" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700" },
  revision_required: { label: "Revision Required", color: "bg-orange-100 text-orange-700" },
  deactivated: { label: "Deactivated", color: "bg-gray-200 text-gray-600" },
};

const SCREENING_BADGE: Record<string, { label: string; color: string }> = {
  Priority: { label: "Priority", color: "bg-green-100 text-green-700" },
  Review: { label: "Review", color: "bg-amber-100 text-amber-700" },
  Hold: { label: "Hold", color: "bg-gray-200 text-gray-600" },
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
  lock_status: string;
  locked_by_client_id: string | null;
  created_at: string;
  profile_completed_at: string;
  photo_pending_review: boolean;
  pending_photo_url: string | null;
  assigned_recruiter: string | null;
  test_events: TestEvent[];
  computer_specs: string | null;
  has_headset: boolean | null;
  has_webcam: boolean | null;
  speed_test_url: string | null;
}

export default function CandidateReviewPage() {
  const [mainTab, setMainTab] = useState<"all" | "pending">("all");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [screeningFilter, setScreeningFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [speakingLevels, setSpeakingLevels] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Record<string, string>>({});
  const [revisionNotes, setRevisionNotes] = useState<Record<string, string>>({});
  const [showRevisionForm, setShowRevisionForm] = useState<Record<string, boolean>>({});
  const [previewCandidate, setPreviewCandidate] = useState<Candidate | null>(null);
  const [earningsModal, setEarningsModal] = useState<{ id: string; current: number } | null>(null);
  const [earningsValue, setEarningsValue] = useState("");
  const [actionsOpen, setActionsOpen] = useState<string | null>(null);
  const [photoReviewCandidate, setPhotoReviewCandidate] = useState<Candidate | null>(null);
  const [cheatFlagThreshold, setCheatFlagThreshold] = useState(3);

  // Load cheat flag threshold from settings
  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/admin/settings");
        if (res.ok) {
          const data = await res.json();
          if (data.settings?.cheat_flag_threshold) {
            setCheatFlagThreshold(data.settings.cheat_flag_threshold);
          }
        }
      } catch { /* silent */ }
    }
    loadSettings();
  }, []);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();

    if (mainTab === "pending") {
      params.set("status", "pending_speaking_review");
    } else {
      params.set("view", "all");
      if (statusFilter !== "all") params.set("status", statusFilter);
    }

    if (search.trim()) params.set("search", search.trim());

    const res = await fetch(`/api/admin/candidates?${params}`);
    const data = await res.json();
    setCandidates(data.candidates || []);
    setLoading(false);
  }, [mainTab, statusFilter, search]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => loadCandidates(), 300);
    return () => clearTimeout(timer);
  }, [search]);

  async function handleAction(
    candidateId: string,
    action: "approve" | "reject" | "flag" | "revision_required" | "deactivate"
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

    if (action === "deactivate") {
      await fetch("/api/admin/candidates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          updates: { admin_status: "deactivated" },
        }),
      });
    } else {
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
    }

    await loadCandidates();
    setActionLoading(null);
    setShowRevisionForm((prev) => ({ ...prev, [candidateId]: false }));
    setActionsOpen(null);
  }

  async function updateEarnings() {
    if (!earningsModal) return;
    setActionLoading(earningsModal.id);

    await fetch("/api/admin/candidates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateId: earningsModal.id,
        updates: { total_earnings_usd: parseFloat(earningsValue) || 0 },
      }),
    });

    setEarningsModal(null);
    setEarningsValue("");
    await loadCandidates();
    setActionLoading(null);
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
      if (mainTab === "pending") {
        const order: Record<string, number> = { Priority: 0, Review: 1, Hold: 2 };
        return (order[a.screening_tag || "Review"] ?? 1) - (order[b.screening_tag || "Review"] ?? 1);
      }
      return 0;
    });

  const isPendingView = mainTab === "pending";

  return (
    <div>
      {/* Main tabs */}
      <div className="flex items-center gap-6 border-b border-gray-200 mb-6">
        <button
          onClick={() => { setMainTab("all"); setStatusFilter("all"); }}
          className={`pb-3 text-sm font-semibold transition-colors ${
            mainTab === "all" ? "border-b-2 border-primary text-primary" : "text-text/40 hover:text-text/70"
          }`}
        >
          All Candidates
        </button>
        <button
          onClick={() => setMainTab("pending")}
          className={`pb-3 text-sm font-semibold transition-colors ${
            mainTab === "pending" ? "border-b-2 border-primary text-primary" : "text-text/40 hover:text-text/70"
          }`}
        >
          Pending Review
        </button>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, country, or email..."
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-text placeholder-text/40 focus:border-primary focus:outline-none"
          />
        </div>

        {mainTab === "all" && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-text focus:border-primary focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="pending_speaking_review">Pending Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="revision_required">Revision Required</option>
            <option value="deactivated">Deactivated</option>
          </select>
        )}

        {isPendingView && (
          <div className="flex gap-2">
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
        )}

        <span className="text-xs text-text/40">{filteredCandidates.length} candidates</span>
      </div>

      {/* Results */}
      {loading ? (
        <p className="mt-8 text-text/60">Loading candidates...</p>
      ) : filteredCandidates.length === 0 ? (
        <p className="mt-8 text-text/60">No candidates found.</p>
      ) : mainTab === "all" ? (
        /* ═══════════ ALL CANDIDATES TABLE VIEW ═══════════ */
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wider text-text/40">
                <th className="pb-3 pr-4">Candidate</th>
                <th className="pb-3 pr-4">Role</th>
                <th className="pb-3 pr-4">Rate</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 pr-4">Lock</th>
                <th className="pb-3 pr-4">Earnings</th>
                <th className="pb-3 pr-4">Recruiter</th>
                <th className="pb-3 pr-4">Applied</th>
                <th className="pb-3 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredCandidates.map((c) => {
                const badge = STATUS_BADGE[c.admin_status] || { label: c.admin_status, color: "bg-gray-100 text-gray-600" };
                return (
                  <tr key={c.id} className="hover:bg-gray-50/50">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 flex-shrink-0 rounded-full overflow-hidden bg-gray-100">
                          {c.profile_photo_url ? (
                            <img src={c.profile_photo_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs font-bold text-text/30">
                              {c.full_name?.charAt(0)}
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-text text-sm">
                            {c.display_name || c.full_name}
                            {c.photo_pending_review && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setPhotoReviewCandidate(c); }}
                                className="ml-1.5 inline-flex items-center rounded-full bg-amber-100 p-0.5 hover:bg-amber-200 transition-colors"
                                title="Photo pending review — click to review"
                              >
                                <svg className="w-3.5 h-3.5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                                  <path d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z" />
                                </svg>
                              </button>
                            )}
                            {Array.isArray(c.test_events) && c.test_events.length >= cheatFlagThreshold && (
                              <span
                                className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
                                title={`${c.test_events.length} cheat flag events detected during test`}
                              >
                                ⚠ High Flag Count ({c.test_events.length})
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-text/40">{c.country}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-xs text-text/70">{c.role_category}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="font-semibold text-text">${c.monthly_rate?.toLocaleString()}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${badge.color}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`text-xs ${c.lock_status === "locked" ? "text-blue-600 font-medium" : "text-text/40"}`}>
                        {c.lock_status === "locked" ? "Locked" : "Available"}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`text-xs font-medium ${Number(c.total_earnings_usd) > 0 ? "text-green-600" : "text-text/30"}`}>
                        ${Number(c.total_earnings_usd || 0).toLocaleString()}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {c.assigned_recruiter ? (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.assigned_recruiter === "Shelly" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                          {c.assigned_recruiter}
                        </span>
                      ) : (
                        <span className="text-xs text-text/30">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="text-xs text-text/40">
                        {c.created_at ? new Date(c.created_at).toLocaleDateString() : "—"}
                      </span>
                    </td>
                    <td className="py-3 pr-4 relative">
                      <button
                        onClick={() => setActionsOpen(actionsOpen === c.id ? null : c.id)}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-text hover:bg-gray-50 transition-colors"
                      >
                        Actions ▾
                      </button>
                      {actionsOpen === c.id && (
                        <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border border-gray-200 bg-white shadow-lg py-1">
                          <button
                            onClick={() => { setPreviewCandidate(c); setActionsOpen(null); }}
                            className="w-full px-4 py-2 text-left text-xs text-text hover:bg-gray-50"
                          >
                            View Profile
                          </button>
                          <button
                            onClick={() => {
                              setEarningsModal({ id: c.id, current: Number(c.total_earnings_usd || 0) });
                              setEarningsValue(String(c.total_earnings_usd || 0));
                              setActionsOpen(null);
                            }}
                            className="w-full px-4 py-2 text-left text-xs text-text hover:bg-gray-50"
                          >
                            Edit Verified Earnings
                          </button>
                          {c.admin_status === "pending_speaking_review" && (
                            <>
                              <div className="border-t border-gray-100 my-1" />
                              <button
                                onClick={() => { setPreviewCandidate(c); setActionsOpen(null); }}
                                className="w-full px-4 py-2 text-left text-xs text-green-700 hover:bg-green-50"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => {
                                  setShowRevisionForm((prev) => ({ ...prev, [c.id]: true }));
                                  setExpandedId(c.id);
                                  setTab(c.id, "recordings");
                                  setActionsOpen(null);
                                }}
                                className="w-full px-4 py-2 text-left text-xs text-amber-700 hover:bg-amber-50"
                              >
                                Send Revision
                              </button>
                              <button
                                onClick={() => { handleAction(c.id, "reject"); setActionsOpen(null); }}
                                className="w-full px-4 py-2 text-left text-xs text-red-700 hover:bg-red-50"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {c.admin_status === "approved" && (
                            <>
                              <div className="border-t border-gray-100 my-1" />
                              <button
                                onClick={() => {
                                  if (confirm("Deactivate this candidate? They will be removed from the public browse page.")) {
                                    handleAction(c.id, "deactivate");
                                  }
                                  setActionsOpen(null);
                                }}
                                className="w-full px-4 py-2 text-left text-xs text-red-700 hover:bg-red-50"
                              >
                                Deactivate
                              </button>
                            </>
                          )}
                          {c.lock_status === "locked" && (
                            <>
                              <div className="border-t border-gray-100 my-1" />
                              <button
                                onClick={() => {
                                  alert(`Locked by client: ${c.locked_by_client_id || "Unknown"}`);
                                  setActionsOpen(null);
                                }}
                                className="w-full px-4 py-2 text-left text-xs text-blue-700 hover:bg-blue-50"
                              >
                                View Lock Details
                              </button>
                            </>
                          )}
                          {/* Recruiter reassignment */}
                          <div className="border-t border-gray-100 my-1" />
                          <button
                            onClick={async () => {
                              const newRecruiter = c.assigned_recruiter === "Shelly" ? "Jerome" : "Shelly";
                              const res = await fetch("/api/admin/candidates/review", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ candidateId: c.id, action: "update_field", updates: { assigned_recruiter: newRecruiter } }),
                              });
                              if (res.ok) {
                                setCandidates((prev) => prev.map((x) => x.id === c.id ? { ...x, assigned_recruiter: newRecruiter } : x));
                              }
                              setActionsOpen(null);
                            }}
                            className="w-full px-4 py-2 text-left text-xs text-text hover:bg-gray-50"
                          >
                            Reassign to {c.assigned_recruiter === "Shelly" ? "Jerome" : "Shelly"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ═══════════ PENDING REVIEW — EXPANDED CARD VIEW ═══════════ */
        <div className="space-y-4">
          {filteredCandidates.map((c) => {
            const isExpanded = expandedId === c.id;
            const cheatCounts = eventTypeCounts(c.test_events || []);
            const tab = getTab(c.id);
            const tools: string[] = c.tools || [];
            const workExp = c.work_experience || [];

            return (
              <div key={c.id} className="rounded-xl border border-gray-200 bg-card overflow-hidden">
                {/* Summary row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                  className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-gray-50"
                >
                  <div className="flex items-center gap-4">
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
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setPreviewCandidate(c); }}
                      className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                    >
                      Preview Profile
                    </button>
                    {c.score_mismatch_flag && (
                      <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">Mismatch</span>
                    )}
                    {c.cheat_flag_count > 0 && (
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">{c.cheat_flag_count} flags</span>
                    )}
                    {c.english_written_tier && (
                      <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">{TIER_LABELS[c.english_written_tier]}</span>
                    )}
                    <svg className={`h-5 w-5 text-text/40 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </div>
                </button>

                {/* Expanded panel */}
                {isExpanded && (
                  <div className="border-t border-gray-200">
                    <div className="flex border-b border-gray-200 px-6">
                      {["overview", "recordings", "interviews", "profile", "test"].map((t) => (
                        <button
                          key={t}
                          onClick={() => setTab(c.id, t)}
                          className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider transition-colors ${
                            tab === t ? "border-b-2 border-primary text-primary" : "text-text/40 hover:text-text/70"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>

                    <div className="px-6 py-5">
                      {tab === "overview" && (
                        <div className="space-y-5">
                          {c.screening_tag && (
                            <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                              <p className="text-xs font-semibold text-text/40 uppercase tracking-wider">AI Screening</p>
                              <p className="mt-1 text-sm text-text/80">{c.screening_reason}</p>
                            </div>
                          )}
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
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div><p className="text-xs text-text/40">Email</p><p className="text-text">{c.email}</p></div>
                            <div><p className="text-xs text-text/40">Experience</p><p className="text-text">{c.years_experience}</p></div>
                            <div><p className="text-xs text-text/40">US Client</p><p className="text-text">{US_EXP_LABELS[c.us_client_experience] || "N/A"}</p></div>
                            <div><p className="text-xs text-text/40">Availability</p><p className="text-text capitalize">{c.availability_status?.replace(/_/g, " ") || "—"}</p></div>
                            <div className="col-span-2"><p className="text-xs text-text/40">Bio</p><p className="text-text">{c.bio || "—"}</p></div>
                          </div>

                          {/* Equipment & Setup */}
                          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Setup &amp; Equipment</p>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <p className="text-xs text-text/40">Computer</p>
                                <p className="text-text">{c.computer_specs || "—"}</p>
                              </div>
                              <div className="flex gap-3">
                                <div>
                                  <p className="text-xs text-text/40">Headset</p>
                                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${c.has_headset ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                                    {c.has_headset ? "Yes" : "No"}
                                  </span>
                                </div>
                                <div>
                                  <p className="text-xs text-text/40">Webcam</p>
                                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${c.has_webcam ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                                    {c.has_webcam ? "Yes" : "No"}
                                  </span>
                                </div>
                              </div>
                              {c.speed_test_url && (
                                <div className="col-span-2">
                                  <p className="text-xs text-text/40 mb-1">Speed Test</p>
                                  <a href={c.speed_test_url} target="_blank" rel="noopener noreferrer" className="inline-block">
                                    <img
                                      src={c.speed_test_url}
                                      alt="Speed test result"
                                      className="max-h-32 rounded-lg border border-gray-200 hover:border-primary transition-colors cursor-pointer"
                                    />
                                    <p className="text-xs text-primary mt-1">Click to view full size ↗</p>
                                  </a>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {tab === "recordings" && (
                        <div className="space-y-5">
                          <div className="grid grid-cols-2 gap-4">
                            <AudioPlayer storagePath={c.voice_recording_1_url} label="Oral Reading" />
                            <AudioPlayer storagePath={c.voice_recording_2_url} label="Self Introduction" />
                          </div>
                          <div className="space-y-4">
                            <div className="rounded-lg border border-primary/20 bg-primary/5 p-5">
                              <p className="text-sm font-semibold text-text mb-3">Assign Speaking Level & Review</p>
                              <div className="flex items-end gap-3 flex-wrap">
                                <div className="flex-1 min-w-[180px]">
                                  <label className="block text-xs font-medium text-text/60 mb-1">Speaking Level</label>
                                  <select
                                    value={speakingLevels[c.id] || ""}
                                    onChange={(e) => setSpeakingLevels((prev) => ({ ...prev, [c.id]: e.target.value }))}
                                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-text focus:border-primary focus:outline-none"
                                  >
                                    <option value="">Select level...</option>
                                    <option value="fluent">Fluent</option>
                                    <option value="proficient">Proficient</option>
                                    <option value="conversational">Conversational</option>
                                    <option value="basic">Basic</option>
                                  </select>
                                </div>
                                <button onClick={() => handleAction(c.id, "approve")} disabled={actionLoading === c.id || !speakingLevels[c.id]} className="rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 transition-colors disabled:opacity-50">
                                  {actionLoading === c.id ? "..." : "Approve"}
                                </button>
                                <button onClick={() => setShowRevisionForm((prev) => ({ ...prev, [c.id]: !prev[c.id] }))} className="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 transition-colors">
                                  Revision Required
                                </button>
                                <button onClick={() => handleAction(c.id, "reject")} disabled={actionLoading === c.id} className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50">
                                  Reject
                                </button>
                              </div>
                            </div>
                            {showRevisionForm[c.id] && (
                              <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
                                <p className="text-sm font-semibold text-amber-900 mb-2">Send Revision Request</p>
                                <textarea value={revisionNotes[c.id] || ""} onChange={(e) => setRevisionNotes((prev) => ({ ...prev, [c.id]: e.target.value }))} placeholder="Describe what the candidate needs to update..." rows={4} className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2.5 text-sm text-text placeholder-text/40 focus:border-amber-500 focus:outline-none resize-none" />
                                <div className="mt-3 flex items-center justify-between">
                                  <p className="text-xs text-amber-700">This will be emailed to {c.email}</p>
                                  <div className="flex gap-2">
                                    <button onClick={() => setShowRevisionForm((prev) => ({ ...prev, [c.id]: false }))} className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 transition-colors">Cancel</button>
                                    <button onClick={() => handleAction(c.id, "revision_required")} disabled={actionLoading === c.id || !revisionNotes[c.id]?.trim()} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 transition-colors disabled:opacity-50">
                                      {actionLoading === c.id ? "Sending..." : "Send & Hold"}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {tab === "interviews" && (
                        <InterviewPanel candidateId={c.id} candidateName={c.full_name} />
                      )}

                      {tab === "profile" && (
                        <div className="space-y-5">
                          {tools.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-2">Tools ({tools.length})</p>
                              <div className="flex flex-wrap gap-2">
                                {tools.map((tool) => (<span key={tool} className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">{tool}</span>))}
                              </div>
                            </div>
                          )}
                          {workExp.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-2">Experience ({workExp.length})</p>
                              <div className="space-y-3">
                                {workExp.map((e, i) => (
                                  <div key={i} className="rounded-lg bg-gray-50 p-3">
                                    <p className="font-medium text-sm text-text">{e.role_title}</p>
                                    <p className="text-xs text-text/50">{e.industry} &middot; {e.duration}</p>
                                    {e.description && <p className="mt-1 text-xs text-text/70">{e.description}</p>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-4">
                            <div><p className="text-xs font-semibold text-text/40 uppercase mb-1">Resume</p>{c.resume_url ? <span className="text-xs text-primary">Uploaded</span> : <span className="text-xs text-text/40 italic">Not uploaded</span>}</div>
                            <div><p className="text-xs font-semibold text-text/40 uppercase mb-1">Payout</p><p className="text-sm text-text capitalize">{c.payout_method?.replace(/_/g, " ") || "—"}</p></div>
                          </div>
                        </div>
                      )}

                      {tab === "test" && (
                        <div className="space-y-5">
                          <div className="grid grid-cols-3 gap-4">
                            <div className="rounded-lg bg-gray-50 p-4 text-center"><p className="text-xs text-text/40">Grammar</p><p className="text-2xl font-bold text-text">{c.english_mc_score ?? "—"}%</p></div>
                            <div className="rounded-lg bg-gray-50 p-4 text-center"><p className="text-xs text-text/40">Comprehension</p><p className="text-2xl font-bold text-text">{c.english_comprehension_score ?? "—"}%</p></div>
                            <div className="rounded-lg bg-gray-50 p-4 text-center"><p className="text-xs text-text/40">Tier</p><p className="text-xl font-bold text-blue-600">{TIER_LABELS[c.english_written_tier] || "—"}</p></div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="rounded-lg border p-3 text-center"><p className="text-xs text-text/40">Mismatch</p><p className={`text-sm font-semibold ${c.score_mismatch_flag ? "text-red-600" : "text-green-600"}`}>{c.score_mismatch_flag ? "FLAGGED" : "Clean"}</p></div>
                            <div className="rounded-lg border p-3 text-center"><p className="text-xs text-text/40">Cheat Flags</p><p className={`text-sm font-semibold ${c.cheat_flag_count > 0 ? "text-amber-600" : "text-green-600"}`}>{c.cheat_flag_count} events</p></div>
                          </div>
                          {(c.test_events || []).length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-2">Cheat Events ({c.test_events.length})</p>
                              <div className="flex flex-wrap gap-2">
                                {Object.entries(cheatCounts).map(([type, count]) => (
                                  <span key={type} className="rounded bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs text-amber-700">{type.replace(/_/g, " ")}: {count}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          <div><p className="text-xs font-semibold text-text/40 uppercase mb-1">ID Verification</p><span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${c.id_verification_status === "passed" ? "bg-green-100 text-green-700" : c.id_verification_status === "failed" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>{c.id_verification_status?.replace(/_/g, " ") || "Pending"}</span></div>
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

      {/* Earnings Edit Modal */}
      {earningsModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={() => setEarningsModal(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-text mb-1">Edit Verified Earnings</h3>
            <p className="text-xs text-text/50 mb-4">Current: ${earningsModal.current.toLocaleString()}</p>
            <div className="flex items-center gap-2">
              <span className="text-lg text-text/40">$</span>
              <input
                type="number"
                value={earningsValue}
                onChange={(e) => setEarningsValue(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-text focus:border-primary focus:outline-none"
                placeholder="0"
                min="0"
                step="0.01"
              />
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => setEarningsModal(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-text hover:bg-gray-50">Cancel</button>
              <button onClick={updateEarnings} disabled={actionLoading === earningsModal.id} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50">
                {actionLoading === earningsModal.id ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo Review Modal */}
      {photoReviewCandidate && (
        <PhotoReviewModal
          candidateId={photoReviewCandidate.id}
          candidateName={photoReviewCandidate.full_name}
          currentPhotoUrl={photoReviewCandidate.profile_photo_url}
          pendingPhotoUrl={photoReviewCandidate.pending_photo_url}
          onClose={() => setPhotoReviewCandidate(null)}
          onComplete={() => {
            setPhotoReviewCandidate(null);
            loadCandidates();
          }}
        />
      )}

      {/* Preview Modal */}
      {previewCandidate && (
        <CandidatePreviewModal
          candidate={previewCandidate}
          onClose={() => setPreviewCandidate(null)}
          onAction={(candidateId, action) => {
            handleAction(candidateId, action);
            setPreviewCandidate(null);
          }}
          speakingLevel={speakingLevels[previewCandidate.id] || ""}
          onSpeakingLevelChange={(level) => setSpeakingLevels((prev) => ({ ...prev, [previewCandidate.id]: level }))}
          revisionNote={revisionNotes[previewCandidate.id] || ""}
          onRevisionNoteChange={(note) => setRevisionNotes((prev) => ({ ...prev, [previewCandidate.id]: note }))}
          actionLoading={actionLoading === previewCandidate.id}
          showActions={previewCandidate.admin_status === "pending_speaking_review" || previewCandidate.admin_status === "revision_required"}
        />
      )}
    </div>
  );
}
