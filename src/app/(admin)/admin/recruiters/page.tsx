"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface RecruiterCandidate {
  id: string;
  display_name: string;
  country: string;
  role_category: string;
  hourly_rate: number;
  screening_tag: string;
  admin_status: string;
  profile_photo_url: string | null;
  created_at: string;
}

interface Recruiter {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
  last_login: string | null;
  assignments: string[];
  total_candidates: number;
  priority_count: number;
  review_count: number;
  hold_count: number;
  status_counts: Record<string, number>;
  candidates: RecruiterCandidate[];
}

const STATUS_COLORS: Record<string, string> = {
  pending_speaking_review: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  revision_required: "bg-orange-100 text-orange-700",
  deactivated: "bg-gray-100 text-gray-500",
};

export default function AdminRecruitersPage() {
  const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadRecruiters();
  }, []);

  async function loadRecruiters() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/recruiters");
      if (res.ok) {
        const data = await res.json();
        setRecruiters(data.recruiters || []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }

  async function handleResetPassword(recruiterId: string) {
    if (!confirm("Are you sure you want to reset this recruiter's password? They will receive an email with a new temporary password.")) {
      return;
    }

    setResetting(recruiterId);
    setResetSuccess(null);

    try {
      const res = await fetch("/api/admin/recruiters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recruiter_id: recruiterId }),
      });

      if (res.ok) {
        const data = await res.json();
        setResetSuccess(data.email);
        setTimeout(() => setResetSuccess(null), 5000);
      }
    } catch { /* silent */ }
    setResetting(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1B1A]">Recruiters</h1>
          <p className="mt-1 text-sm text-gray-500">
            Overview of all recruiter accounts, assignments, and candidate distribution.
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-[#FE6E3E]">{recruiters.length}</p>
          <p className="text-xs text-gray-500">Active recruiters</p>
        </div>
      </div>

      {resetSuccess && (
        <div className="mb-4 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
          ✓ Password reset email sent to <strong>{resetSuccess}</strong> and confirmation sent to Sam.
        </div>
      )}

      {recruiters.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
          <p className="text-gray-500">No recruiter accounts found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {recruiters.map((r) => (
            <div key={r.id} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50/50 transition-colors"
                onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="h-10 w-10 flex-shrink-0 rounded-full bg-[#FE6E3E]/10 flex items-center justify-center">
                    <span className="text-sm font-bold text-[#FE6E3E]">
                      {r.full_name?.charAt(0) || "?"}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-[#1C1B1A] text-sm">{r.full_name}</p>
                    <p className="text-xs text-gray-400 truncate">{r.email}</p>
                  </div>
                  <div className="hidden md:flex flex-wrap gap-1 max-w-xs">
                    {r.assignments.slice(0, 3).map((a) => (
                      <span key={a} className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-[#FE6E3E]">
                        {a}
                      </span>
                    ))}
                    {r.assignments.length > 3 && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                        +{r.assignments.length - 3} more
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="hidden sm:flex items-center gap-2 text-xs">
                    <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-700">
                      {r.priority_count} Priority
                    </span>
                    <span className="rounded-full bg-yellow-100 px-2 py-0.5 font-semibold text-yellow-700">
                      {r.review_count} Review
                    </span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-600">
                      {r.hold_count} Hold
                    </span>
                  </div>

                  <div className="text-right hidden sm:block">
                    <p className="text-sm font-bold text-[#1C1B1A]">{r.total_candidates}</p>
                    <p className="text-[10px] text-gray-400">candidates</p>
                  </div>

                  <div className="text-right hidden lg:block">
                    <p className="text-xs text-gray-400">
                      {r.last_login
                        ? `Last login: ${new Date(r.last_login).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                        : "Never logged in"}
                    </p>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleResetPassword(r.id);
                    }}
                    disabled={resetting === r.id}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-red-300 hover:text-red-600 transition-colors disabled:opacity-50"
                  >
                    {resetting === r.id ? "Resetting..." : "Reset Password"}
                  </button>

                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${expandedId === r.id ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {expandedId === r.id && (
                <div className="border-t border-gray-100 bg-gray-50/30 p-4">
                  <div className="mb-4">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Assigned Categories</p>
                    <div className="flex flex-wrap gap-1.5">
                      {r.assignments.map((a) => (
                        <span key={a} className="rounded-full bg-orange-50 border border-orange-200 px-2.5 py-0.5 text-xs font-medium text-[#FE6E3E]">
                          {a}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mb-4">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Status Breakdown</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(r.status_counts).map(([status, count]) => (
                        <span key={status} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status] || "bg-gray-100 text-gray-600"}`}>
                          {status.replace(/_/g, " ")}: {count}
                        </span>
                      ))}
                    </div>
                  </div>

                  {r.candidates.length === 0 ? (
                    <p className="text-sm text-gray-400">No candidates in assigned categories yet.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                      <table className="w-full text-left text-sm">
                        <thead className="border-b border-gray-100 bg-gray-50/50">
                          <tr>
                            <th className="px-3 py-2 font-medium text-gray-500 text-xs">Candidate</th>
                            <th className="px-3 py-2 font-medium text-gray-500 text-xs">Role</th>
                            <th className="px-3 py-2 font-medium text-gray-500 text-xs">Rate</th>
                            <th className="px-3 py-2 font-medium text-gray-500 text-xs">AI Tag</th>
                            <th className="px-3 py-2 font-medium text-gray-500 text-xs">Status</th>
                            <th className="px-3 py-2 font-medium text-gray-500 text-xs">Applied</th>
                            <th className="px-3 py-2 font-medium text-gray-500 text-xs"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {r.candidates.map((c) => (
                            <tr key={c.id} className="hover:bg-gray-50/50">
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <div className="h-7 w-7 flex-shrink-0 overflow-hidden rounded-full bg-gray-100">
                                    {c.profile_photo_url ? (
                                      <img src={c.profile_photo_url} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-gray-400">
                                        {c.display_name?.charAt(0) || "?"}
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    <p className="font-medium text-[#1C1B1A] text-xs">{c.display_name}</p>
                                    <p className="text-[10px] text-gray-400">{c.country}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-gray-600">{c.role_category}</span>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs font-semibold text-[#1C1B1A]">${c.hourly_rate?.toLocaleString()}</span>
                              </td>
                              <td className="px-3 py-2">
                                {c.screening_tag && (
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                    c.screening_tag === "Priority" ? "bg-green-100 text-green-700" :
                                    c.screening_tag === "Review" ? "bg-yellow-100 text-yellow-700" :
                                    "bg-gray-100 text-gray-600"
                                  }`}>
                                    {c.screening_tag}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[c.admin_status] || "bg-gray-100 text-gray-600"}`}>
                                  {c.admin_status?.replace(/_/g, " ")}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-[10px] text-gray-400">
                                {c.created_at ? new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                              </td>
                              <td className="px-3 py-2">
                                <Link
                                  href={`/candidate/${c.id}`}
                                  className="text-[10px] font-medium text-[#FE6E3E] hover:underline"
                                >
                                  View
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
