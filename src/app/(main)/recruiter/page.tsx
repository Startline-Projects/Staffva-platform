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
  monthly_rate: number;
  english_written_tier: string;
  speaking_level: string;
  screening_tag: string;
  screening_score: number;
  admin_status: string;
  profile_photo_url: string | null;
  created_at: string;
  waiting_since: string | null;
  second_interview_status: string;
  second_interview_scheduled_at: string | null;
  assigned_recruiter: string | null;
  sla_status: "green" | "yellow" | "red";
  wait_hours: number;
}

interface Workload {
  total: number;
  pending_second: number;
  scheduled: number;
  completed_this_week: number;
  avg_wait_hours: number;
  red_count: number;
  yellow_count: number;
  green_count: number;
}

const SLA_COLORS = {
  green: { bg: "bg-green-50", border: "border-green-200", dot: "bg-green-500", text: "text-green-700" },
  yellow: { bg: "bg-yellow-50", border: "border-yellow-200", dot: "bg-yellow-500", text: "text-yellow-700" },
  red: { bg: "bg-red-50", border: "border-red-200", dot: "bg-red-500", text: "text-red-700" },
};

const SCREENING_COLORS: Record<string, string> = {
  Priority: "bg-green-100 text-green-700",
  Review: "bg-yellow-100 text-yellow-700",
  Hold: "bg-gray-100 text-gray-600",
};

export default function RecruiterDashboardPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [workload, setWorkload] = useState<Workload | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [scheduleModal, setScheduleModal] = useState<{ candidateId: string; name: string } | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduling, setScheduling] = useState(false);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/login"); return; }

      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(`/api/recruiter/queue?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.status === 403) { router.push("/"); return; }
      if (!res.ok) { setLoading(false); return; }

      const data = await res.json();
      setCandidates(data.candidates || []);
      setWorkload(data.workload || null);
    } catch { /* silent */ }
    setLoading(false);
  }, [statusFilter, router]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  async function handleSchedule() {
    if (!scheduleModal || !scheduleDate || !scheduleTime) return;
    setScheduling(true);

    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await fetch("/api/recruiter/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ candidateId: scheduleModal.candidateId, scheduledDate: scheduleDate, scheduledTime: scheduleTime }),
    });

    setScheduleModal(null);
    setScheduleDate("");
    setScheduleTime("");
    setScheduling(false);
    loadQueue();
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" /></div>;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold text-[#1C1B1A]">Recruiter Dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">Priority queue — longest waiting candidates first</p>

      {/* Workload summary bar */}
      {workload && (
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
            <p className="text-xl font-bold text-[#1C1B1A]">{workload.total}</p>
            <p className="text-[10px] text-gray-500 font-medium uppercase">Total Assigned</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
            <p className="text-xl font-bold text-[#FE6E3E]">{workload.pending_second}</p>
            <p className="text-[10px] text-gray-500 font-medium uppercase">Pending Interview</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
            <p className="text-xl font-bold text-blue-600">{workload.scheduled}</p>
            <p className="text-[10px] text-gray-500 font-medium uppercase">Scheduled</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
            <p className="text-xl font-bold text-green-600">{workload.completed_this_week}</p>
            <p className="text-[10px] text-gray-500 font-medium uppercase">Completed (Week)</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
            <p className="text-xl font-bold text-[#1C1B1A]">{workload.avg_wait_hours}h</p>
            <p className="text-[10px] text-gray-500 font-medium uppercase">Avg Wait</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
            <div className="flex items-center justify-center gap-2">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" />{workload.red_count}</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-500" />{workload.yellow_count}</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" />{workload.green_count}</span>
            </div>
            <p className="text-[10px] text-gray-500 font-medium uppercase mt-1">SLA Status</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mt-6 flex gap-2">
        {["all", "pending_speaking_review", "approved", "revision_required"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === s ? "bg-[#FE6E3E] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {s === "all" ? "All" : s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {/* Priority queue */}
      {candidates.length === 0 ? (
        <div className="mt-8 rounded-lg border border-gray-200 bg-white p-12 text-center">
          <p className="text-gray-500">No candidates in your queue.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {candidates.map((c) => {
            const sla = SLA_COLORS[c.sla_status];

            return (
              <div
                key={c.id}
                className={`rounded-lg border ${sla.border} ${sla.bg} p-4 transition-colors`}
              >
                <div className="flex items-start gap-4">
                  {/* SLA dot */}
                  <div className="flex flex-col items-center gap-1 pt-1">
                    <span className={`h-3 w-3 rounded-full ${sla.dot}`} />
                    <span className={`text-[9px] font-medium ${sla.text}`}>{c.wait_hours}h</span>
                  </div>

                  {/* Photo */}
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-100">
                    {c.profile_photo_url ? (
                      <img src={c.profile_photo_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-bold text-gray-400">
                        {c.display_name?.[0] || "?"}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-[#1C1B1A] text-sm">{c.display_name || c.full_name}</p>
                        <p className="text-xs text-gray-500">{c.country} · {c.role_category} · ${c.monthly_rate?.toLocaleString()}/mo</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {c.screening_tag && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SCREENING_COLORS[c.screening_tag] || "bg-gray-100 text-gray-600"}`}>
                            {c.screening_tag} {c.screening_score}/10
                          </span>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          c.admin_status === "approved" ? "bg-green-100 text-green-700" :
                          c.admin_status === "pending_speaking_review" ? "bg-yellow-100 text-yellow-700" :
                          "bg-gray-100 text-gray-600"
                        }`}>
                          {c.admin_status?.replace(/_/g, " ")}
                        </span>
                      </div>
                    </div>

                    {/* Interview status */}
                    <div className="mt-2 flex items-center gap-3 flex-wrap">
                      {c.second_interview_status === "scheduled" && c.second_interview_scheduled_at && (
                        <span className="text-[11px] text-blue-600 font-medium">
                          Interview: {new Date(c.second_interview_scheduled_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </span>
                      )}
                      {c.second_interview_status === "completed" && (
                        <span className="text-[11px] text-green-600 font-medium">Interview complete</span>
                      )}

                      {/* Actions */}
                      <div className="ml-auto flex gap-2">
                        <Link
                          href={`/candidate/${c.id}`}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-[#1C1B1A] hover:border-[#FE6E3E] hover:text-[#FE6E3E] transition-colors"
                        >
                          View Profile
                        </Link>
                        {c.second_interview_status !== "scheduled" && c.second_interview_status !== "completed" && (
                          <button
                            onClick={() => setScheduleModal({ candidateId: c.id, name: c.display_name || c.full_name })}
                            className="rounded-lg bg-[#FE6E3E] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#E55A2B] transition-colors"
                          >
                            Schedule Interview
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Read-only notice */}
      <div className="mt-6 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
        <p className="text-xs text-gray-500">
          <strong>Recruiter access.</strong> You can view profiles, schedule interviews, and send calendar invites.
          Approval actions are managed by the admin team.
        </p>
      </div>

      {/* Schedule interview modal */}
      {scheduleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setScheduleModal(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[#1C1B1A]">Schedule Interview</h2>
            <p className="mt-1 text-sm text-gray-500">Schedule a second interview with {scheduleModal.name}</p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-[#1C1B1A]">Date</label>
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1C1B1A]">Time (UTC)</label>
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E]"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button onClick={() => setScheduleModal(null)} className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-[#1C1B1A] hover:bg-gray-50">Cancel</button>
              <button
                onClick={handleSchedule}
                disabled={scheduling || !scheduleDate || !scheduleTime}
                className="flex-1 rounded-lg bg-[#FE6E3E] py-2.5 text-sm font-semibold text-white hover:bg-[#E55A2B] disabled:opacity-50"
              >
                {scheduling ? "Scheduling..." : "Schedule & Send Invite"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
