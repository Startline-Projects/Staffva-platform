"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  funded: { label: "Funded — Period Active", color: "bg-green-100 text-green-700" },
  released: { label: "Released", color: "bg-gray-100 text-gray-600" },
  disputed: { label: "Dispute Filed", color: "bg-red-100 text-red-700" },
  refunded: { label: "Refunded", color: "bg-amber-100 text-amber-700" },
};

const MILESTONE_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-gray-100 text-gray-600" },
  funded: { label: "Funded", color: "bg-blue-100 text-blue-700" },
  candidate_marked_complete: { label: "Marked Complete", color: "bg-amber-100 text-amber-700" },
  approved: { label: "Approved", color: "bg-green-100 text-green-700" },
  released: { label: "Released", color: "bg-green-100 text-green-700" },
  disputed: { label: "Disputed", color: "bg-red-100 text-red-700" },
  refunded: { label: "Refunded", color: "bg-gray-100 text-gray-600" },
};

const ENG_STATUS: Record<string, { label: string; color: string }> = {
  active: { label: "Active", color: "bg-green-100 text-green-700" },
  payment_failed: { label: "Payment Failed", color: "bg-red-100 text-red-700" },
  released: { label: "Released", color: "bg-gray-100 text-gray-600" },
  completed: { label: "Completed", color: "bg-blue-100 text-blue-700" },
};

interface Engagement {
  id: string;
  candidate_id: string;
  contract_type: string;
  payment_cycle: string | null;
  candidate_rate_usd: number;
  platform_fee_usd: number;
  client_total_usd: number;
  status: string;
  created_at: string;
  candidate: {
    full_name: string;
    display_name: string;
    role_category: string;
    lock_status: string;
  } | null;
  latest_period: {
    id: string;
    period_start: string;
    period_end: string;
    status: string;
  } | null;
  milestones: {
    id: string;
    title: string;
    amount_usd: number;
    status: string;
  }[];
}

export default function TeamPortalPage() {
  const router = useRouter();
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [clientId, setClientId] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadEngagements();
  }, []);

  async function loadEngagements() {
    const res = await fetch("/api/engagements/list");
    const data = await res.json();
    setEngagements(data.engagements || []);
    setClientId(data.clientId || "");
    setLoading(false);
  }

  async function handleFundPeriod(engagementId: string) {
    setActionLoading(engagementId);
    await fetch("/api/engagements/periods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId }),
    });
    await loadEngagements();
    setActionLoading(null);
  }

  async function handleRelease(engagementId: string) {
    if (!confirm("Release this candidate? Their profile will go live on browse immediately.")) return;
    setActionLoading(engagementId);
    await fetch("/api/engagements/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId }),
    });
    await loadEngagements();
    setActionLoading(null);
  }

  async function handleApproveMilestone(milestoneId: string) {
    setActionLoading(milestoneId);
    await fetch("/api/engagements/milestones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ milestoneId, action: "approve" }),
    });
    await loadEngagements();
    setActionLoading(null);
  }

  const activeEngagements = engagements.filter((e) => e.status === "active");
  const pastEngagements = engagements.filter((e) => e.status !== "active");

  if (loading) {
    return (
      <main className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background">
        <p className="text-text/60">Loading your team...</p>
      </main>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text">My Team</h1>
        <button
          onClick={() => router.push("/browse")}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
        >
          Browse Talent
        </button>
      </div>

      {engagements.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-lg font-medium text-text">No hires yet</p>
          <p className="mt-1 text-sm text-text/60">
            Browse candidates and hire your first team member.
          </p>
        </div>
      ) : (
        <>
          {/* Active engagements */}
          {activeEngagements.length > 0 && (
            <div className="mt-8">
              <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider">
                Active ({activeEngagements.length})
              </h2>
              <div className="mt-4 space-y-4">
                {activeEngagements.map((eng) => (
                  <div
                    key={eng.id}
                    className="rounded-xl border border-gray-200 bg-card p-6"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-lg font-semibold text-text">
                          {eng.candidate?.full_name || eng.candidate?.display_name || "Unknown"}
                        </p>
                        <p className="text-sm text-text/60">
                          {eng.candidate?.role_category} &middot;{" "}
                          {eng.contract_type === "ongoing"
                            ? `Ongoing (${eng.payment_cycle})`
                            : "Project"}
                        </p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${ENG_STATUS[eng.status]?.color || "bg-gray-100 text-gray-600"}`}>
                        {ENG_STATUS[eng.status]?.label || eng.status}
                      </span>
                    </div>

                    {/* Rate info */}
                    <div className="mt-4 flex gap-6 text-sm">
                      <div>
                        <p className="text-xs text-text/40">Candidate Rate</p>
                        <p className="font-medium text-text">${Number(eng.candidate_rate_usd).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-text/40">Platform Fee</p>
                        <p className="font-medium text-text">${Number(eng.platform_fee_usd).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-text/40">You Pay</p>
                        <p className="font-semibold text-primary">${Number(eng.client_total_usd).toLocaleString()}</p>
                      </div>
                    </div>

                    {/* Ongoing: latest period */}
                    {eng.contract_type === "ongoing" && eng.latest_period && (
                      <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3 flex items-center justify-between">
                        <div>
                          <p className="text-xs text-text/40">Current Period</p>
                          <p className="text-sm text-text">
                            {new Date(eng.latest_period.period_start).toLocaleDateString()} —{" "}
                            {new Date(eng.latest_period.period_end).toLocaleDateString()}
                          </p>
                        </div>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_LABELS[eng.latest_period.status]?.color || "bg-gray-100"}`}>
                          {STATUS_LABELS[eng.latest_period.status]?.label || eng.latest_period.status}
                        </span>
                      </div>
                    )}

                    {/* Ongoing: fund next period button */}
                    {eng.contract_type === "ongoing" && (
                      <div className="mt-4">
                        <button
                          onClick={() => handleFundPeriod(eng.id)}
                          disabled={actionLoading === eng.id}
                          className="rounded-lg border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
                        >
                          {actionLoading === eng.id ? "Creating..." : "Fund Next Period"}
                        </button>
                      </div>
                    )}

                    {/* Project: milestones */}
                    {eng.contract_type === "project" && eng.milestones.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs text-text/40 mb-2">Milestones</p>
                        <div className="space-y-2">
                          {eng.milestones.map((ms) => (
                            <div
                              key={ms.id}
                              className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
                            >
                              <div>
                                <p className="text-sm font-medium text-text">{ms.title}</p>
                                <p className="text-xs text-text/40">${Number(ms.amount_usd).toLocaleString()}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${MILESTONE_LABELS[ms.status]?.color || "bg-gray-100"}`}>
                                  {MILESTONE_LABELS[ms.status]?.label || ms.status}
                                </span>
                                {ms.status === "candidate_marked_complete" && (
                                  <button
                                    onClick={() => handleApproveMilestone(ms.id)}
                                    disabled={actionLoading === ms.id}
                                    className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                                  >
                                    Approve
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="mt-4 flex gap-3 border-t border-gray-100 pt-4">
                      <button
                        onClick={() => router.push(`/inbox?candidate=${eng.candidate_id}&client=${clientId}`)}
                        className="text-sm text-primary hover:text-primary-dark"
                      >
                        Message
                      </button>
                      <button
                        onClick={() => handleRelease(eng.id)}
                        disabled={actionLoading === eng.id}
                        className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                      >
                        Release Candidate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Past engagements */}
          {pastEngagements.length > 0 && (
            <div className="mt-10">
              <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider">
                Past ({pastEngagements.length})
              </h2>
              <div className="mt-4 space-y-3">
                {pastEngagements.map((eng) => (
                  <div
                    key={eng.id}
                    className="flex items-center justify-between rounded-xl border border-gray-200 bg-card px-6 py-4"
                  >
                    <div>
                      <p className="font-medium text-text">
                        {eng.candidate?.display_name || "Unknown"}
                      </p>
                      <p className="text-xs text-text/60">
                        {eng.candidate?.role_category} &middot;{" "}
                        {eng.contract_type === "ongoing" ? "Ongoing" : "Project"} &middot;{" "}
                        Started {new Date(eng.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${ENG_STATUS[eng.status]?.color || "bg-gray-100"}`}>
                      {ENG_STATUS[eng.status]?.label || eng.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
