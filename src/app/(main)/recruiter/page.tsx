"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface Candidate {
  id: string;
  full_name: string;
  display_name: string;
  email: string;
  country: string;
  role_category: string;
  years_experience: string;
  monthly_rate: number;
  english_written_tier: string;
  speaking_level: string;
  us_client_experience: string;
  admin_status: string;
  screening_tag: string;
  screening_score: number;
  screening_reason: string;
  availability_status: string;
  committed_hours: number;
  total_earnings_usd: number;
  profile_photo_url: string | null;
  bio: string;
  created_at: string;
  cheat_flag_count: number;
  assigned_recruiter: string | null;
}

const SCREENING_COLORS: Record<string, string> = {
  Priority: "bg-green-100 text-green-700",
  Review: "bg-yellow-100 text-yellow-700",
  Hold: "bg-gray-100 text-gray-600",
};

const STATUS_COLORS: Record<string, string> = {
  pending_speaking_review: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  revision_required: "bg-orange-100 text-orange-700",
  deactivated: "bg-gray-100 text-gray-500",
};

function tierColor(tier: string) {
  switch (tier) {
    case "exceptional": return "bg-green-100 text-green-700";
    case "proficient": return "bg-blue-100 text-blue-700";
    case "competent": return "bg-gray-100 text-gray-600";
    default: return "bg-gray-100 text-gray-600";
  }
}

function speakingColor(level: string) {
  switch (level) {
    case "fluent": return "bg-green-100 text-green-700";
    case "proficient": return "bg-blue-100 text-blue-700";
    case "conversational": return "bg-yellow-100 text-yellow-700";
    case "basic": return "bg-gray-100 text-gray-600";
    default: return "bg-gray-100 text-gray-600";
  }
}

export default function RecruiterDashboardPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [screeningFilter, setScreeningFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [assignedCategories, setAssignedCategories] = useState<string[]>([]);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (screeningFilter !== "all") params.set("screening", screeningFilter);
      if (search) params.set("search", search);

      const res = await fetch(`/api/recruiter/candidates?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.status === 403) {
        router.push("/");
        return;
      }

      if (!res.ok) {
        setError("Failed to load candidates");
        setLoading(false);
        return;
      }

      const data = await res.json();
      setCandidates(data.candidates || []);
      setAssignedCategories(data.assignedCategories || []);
    } catch {
      setError("Failed to load candidates");
    }
    setLoading(false);
  }, [statusFilter, screeningFilter, search, router]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  // Sort: Priority first by default
  const sorted = [...candidates].sort((a, b) => {
    const order: Record<string, number> = { Priority: 0, Review: 1, Hold: 2 };
    return (order[a.screening_tag] ?? 3) - (order[b.screening_tag] ?? 3);
  });

  const counts = {
    all: candidates.length,
    Priority: candidates.filter((c) => c.screening_tag === "Priority").length,
    Review: candidates.filter((c) => c.screening_tag === "Review").length,
    Hold: candidates.filter((c) => c.screening_tag === "Hold").length,
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1B1A]">
            Recruiter Dashboard
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Viewing candidates in your assigned categories
            {assignedCategories.length > 0 && (
              <span className="ml-1">
                ({assignedCategories.length} categories)
              </span>
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-[#FE6E3E]">{candidates.length}</p>
          <p className="text-xs text-gray-500">Total candidates</p>
        </div>
      </div>

      {/* Assigned categories */}
      {assignedCategories.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-1.5">
          {assignedCategories.map((cat) => (
            <span
              key={cat}
              className="rounded-full bg-orange-50 border border-orange-200 px-2.5 py-0.5 text-xs font-medium text-[#FE6E3E]"
            >
              {cat}
            </span>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 space-y-3">
        <div className="flex gap-2">
          {(["all", "Priority", "Review", "Hold"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setScreeningFilter(f)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                screeningFilter === f
                  ? "bg-[#FE6E3E] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f === "all" ? "All" : f}{" "}
              <span className="ml-0.5 opacity-70">
                {f === "all" ? counts.all : counts[f]}
              </span>
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Search by name, country, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-[#1C1B1A] placeholder-gray-400 focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E]"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-[#1C1B1A] focus:border-[#FE6E3E] focus:outline-none"
          >
            <option value="all">All statuses</option>
            <option value="pending_speaking_review">Pending Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="revision_required">Revision Required</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
          <p className="text-gray-500">No candidates found matching your filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/50">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-500">Candidate</th>
                <th className="px-4 py-3 font-medium text-gray-500">Role</th>
                <th className="px-4 py-3 font-medium text-gray-500">Rate</th>
                <th className="px-4 py-3 font-medium text-gray-500">English</th>
                <th className="px-4 py-3 font-medium text-gray-500">Speaking</th>
                <th className="px-4 py-3 font-medium text-gray-500">AI Tag</th>
                <th className="px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 font-medium text-gray-500">Applied</th>
                <th className="px-4 py-3 font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-full bg-gray-100">
                        {c.profile_photo_url ? (
                          <img src={c.profile_photo_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs font-bold text-gray-400">
                            {c.display_name?.charAt(0) || c.full_name?.charAt(0) || "?"}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-[#1C1B1A]">
                          {c.display_name || c.full_name}
                        </p>
                        <p className="text-xs text-gray-400">{c.country}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-[#FE6E3E]">
                      {c.role_category}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-[#1C1B1A]">
                      ${c.monthly_rate?.toLocaleString()}
                    </span>
                    <span className="text-xs text-gray-400">/mo</span>
                  </td>
                  <td className="px-4 py-3">
                    {c.english_written_tier && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${tierColor(c.english_written_tier)}`}>
                        {c.english_written_tier}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.speaking_level && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${speakingColor(c.speaking_level)}`}>
                        {c.speaking_level}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.screening_tag && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SCREENING_COLORS[c.screening_tag] || "bg-gray-100 text-gray-600"}`}>
                        {c.screening_tag === "Priority" && "🟢 "}
                        {c.screening_tag === "Review" && "🟡 "}
                        {c.screening_tag === "Hold" && "⚪ "}
                        {c.screening_tag}
                        {c.screening_score ? ` ${c.screening_score}/10` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[c.admin_status] || "bg-gray-100 text-gray-600"}`}>
                      {c.admin_status?.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {c.created_at
                      ? new Date(c.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/candidate/${c.id}`}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-[#1C1B1A] hover:border-[#FE6E3E] hover:text-[#FE6E3E] transition-colors"
                    >
                      View Profile
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Read-only notice */}
      <div className="mt-6 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
        <p className="text-xs text-gray-500">
          <strong>Read-only access.</strong> You can view candidate profiles, test scores, and recordings.
          Approval, rejection, and revision actions are managed by the admin team.
        </p>
      </div>
    </div>
  );
}
