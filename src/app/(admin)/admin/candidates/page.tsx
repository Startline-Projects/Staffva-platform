"use client";

import { useState, useEffect } from "react";

const TIER_LABELS: Record<string, string> = {
  exceptional: "Exceptional",
  proficient: "Proficient",
  competent: "Competent",
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
  email: string;
  country: string;
  role_category: string;
  years_experience: string;
  monthly_rate: number;
  bio: string;
  english_mc_score: number;
  english_comprehension_score: number;
  english_percentile: number;
  english_written_tier: string;
  cheat_flag_count: number;
  score_mismatch_flag: boolean;
  id_verification_status: string;
  us_client_experience: string;
  us_client_description: string;
  voice_recording_1_url: string;
  voice_recording_2_url: string;
  screening_tag: string | null;
  screening_score: number | null;
  screening_reason: string | null;
  created_at: string;
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
    action: "approve" | "reject" | "flag"
  ) {
    if (action === "approve" && !speakingLevels[candidateId]) {
      alert("Please select a speaking level before approving.");
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
      }),
    });

    setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
    setActionLoading(null);
  }

  const eventTypeCounts = (events: TestEvent[]) => {
    const counts: Record<string, number> = {};
    for (const e of events) {
      counts[e.event_type] = (counts[e.event_type] || 0) + 1;
    }
    return counts;
  };

  // Filter by screening tag and sort Priority first
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
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Screening filter */}
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
            const cheatCounts = eventTypeCounts(c.test_events);

            return (
              <div
                key={c.id}
                className="rounded-xl border border-gray-200 bg-card overflow-hidden"
              >
                {/* Summary row */}
                <button
                  onClick={() =>
                    setExpandedId(isExpanded ? null : c.id)
                  }
                  className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-gray-50"
                >
                  <div className="flex items-center gap-4">
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
                        {c.country} &middot; {c.role_category} &middot; $
                        {c.monthly_rate}/mo
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {c.id_verification_status === "passed" ? (
                      <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                        ID Verified
                      </span>
                    ) : c.id_verification_status === "failed" ? (
                      <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                        ID Failed
                      </span>
                    ) : c.id_verification_status === "manual_review" ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                        ID Manual Review
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                        ID Pending
                      </span>
                    )}
                    {c.score_mismatch_flag && (
                      <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                        Score Mismatch
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
                    <svg
                      className={`h-5 w-5 text-text/40 transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                      />
                    </svg>
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-gray-200 px-6 py-5 space-y-5">
                    {/* AI Screening */}
                    {c.screening_tag && (
                      <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                        <p className="text-xs font-semibold text-text/40 uppercase tracking-wider">
                          AI Screening
                        </p>
                        <p className="mt-1 text-sm text-text/80">
                          {c.screening_reason}
                        </p>
                      </div>
                    )}

                    {/* Scores */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="rounded-lg bg-gray-50 p-3">
                        <p className="text-xs text-text/40">Grammar</p>
                        <p className="text-xl font-bold text-text">
                          {c.english_mc_score}%
                        </p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <p className="text-xs text-text/40">Comprehension</p>
                        <p className="text-xl font-bold text-text">
                          {c.english_comprehension_score}%
                        </p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <p className="text-xs text-text/40">Combined</p>
                        <p className="text-xl font-bold text-text">
                          {c.english_percentile}%
                        </p>
                      </div>
                    </div>

                    {/* Details */}
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
                        <p className="text-text">
                          {US_EXP_LABELS[c.us_client_experience] || "N/A"}
                        </p>
                      </div>
                      {c.us_client_description && (
                        <div>
                          <p className="text-xs text-text/40">US Work Description</p>
                          <p className="text-text">{c.us_client_description}</p>
                        </div>
                      )}
                      <div className="col-span-2">
                        <p className="text-xs text-text/40">Bio</p>
                        <p className="text-text">{c.bio}</p>
                      </div>
                    </div>

                    {/* Cheat event log */}
                    {c.test_events.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-2">
                          Cheat Event Log ({c.test_events.length} events)
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(cheatCounts).map(([type, count]) => (
                            <span
                              key={type}
                              className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700"
                            >
                              {type.replace("_", " ")}: {count}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Voice recordings */}
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-text/40 uppercase tracking-wider">
                        Voice Recordings
                      </p>
                      {c.voice_recording_1_url ? (
                        <div>
                          <p className="mb-1 text-xs font-medium text-text/60">
                            Oral Reading
                          </p>
                          <audio
                            controls
                            src={c.voice_recording_1_url}
                            className="w-full"
                          />
                        </div>
                      ) : (
                        <p className="text-xs text-text/40">No oral reading recorded</p>
                      )}
                      {c.voice_recording_2_url ? (
                        <div>
                          <p className="mb-1 text-xs font-medium text-text/60">
                            Self Introduction
                          </p>
                          <audio
                            controls
                            src={c.voice_recording_2_url}
                            className="w-full"
                          />
                        </div>
                      ) : (
                        <p className="text-xs text-text/40">No self introduction recorded</p>
                      )}
                    </div>

                    {/* Actions */}
                    {filter === "pending_speaking_review" && (
                      <div className="border-t border-gray-200 pt-4">
                        <div className="flex items-end gap-4">
                          <div className="flex-1">
                            <label className="block text-xs font-medium text-text/60 mb-1">
                              Speaking Level (required for approval)
                            </label>
                            <select
                              value={speakingLevels[c.id] || ""}
                              onChange={(e) =>
                                setSpeakingLevels((prev) => ({
                                  ...prev,
                                  [c.id]: e.target.value,
                                }))
                              }
                              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
                            >
                              <option value="">Select level...</option>
                              <option value="fluent">Fluent</option>
                              <option value="proficient">Proficient</option>
                              <option value="conversational">
                                Conversational
                              </option>
                              <option value="basic">Basic</option>
                            </select>
                          </div>
                          <button
                            onClick={() => handleAction(c.id, "approve")}
                            disabled={
                              actionLoading === c.id ||
                              !speakingLevels[c.id]
                            }
                            className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleAction(c.id, "reject")}
                            disabled={actionLoading === c.id}
                            className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                          >
                            Reject
                          </button>
                          <button
                            onClick={() => handleAction(c.id, "flag")}
                            disabled={actionLoading === c.id}
                            className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-text hover:bg-gray-50 transition-colors disabled:opacity-50"
                          >
                            Flag
                          </button>
                        </div>
                      </div>
                    )}
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
