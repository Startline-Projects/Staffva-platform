"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Candidate {
  id: string;
  display_name: string;
  country: string;
  role_category: string;
  monthly_rate: number;
  screening_tag: string;
  screening_score: number;
  admin_status: string;
  profile_photo_url: string | null;
  waiting_since: string | null;
  second_interview_status: string;
  assigned_recruiter: string | null;
  sla_status: "green" | "yellow" | "red";
  wait_hours: number;
}

interface RecruiterSummary {
  recruiter: string;
  count: number;
  red: number;
  avgWait: number;
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

const SLA_DOT: Record<string, string> = { green: "bg-green-500", yellow: "bg-yellow-500", red: "bg-red-500" };

export default function AdminTriagePage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [workload, setWorkload] = useState<Workload | null>(null);
  const [breakdown, setBreakdown] = useState<Record<string, RecruiterSummary>>({});
  const [loading, setLoading] = useState(true);
  const [selectedRecruiter, setSelectedRecruiter] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/recruiter/queue?view=admin", {
          headers: { Authorization: `Bearer ${document.cookie}` },
        });

        // Fallback — use cookie-based auth from admin layout
        const supabase = (await import("@/lib/supabase/client")).createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res2 = await fetch("/api/recruiter/queue?view=admin", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (res2.ok) {
          const data = await res2.json();
          setCandidates(data.candidates || []);
          setWorkload(data.workload || null);
          setBreakdown(data.recruiterBreakdown || {});
        }
      } catch { /* silent */ }
      setLoading(false);
    }
    load();
  }, []);

  const filteredCandidates = selectedRecruiter
    ? candidates.filter((c) => (c.assigned_recruiter || "Unassigned") === selectedRecruiter)
    : candidates;

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" /></div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1C1B1A]">Cross-Recruiter Triage</h1>
      <p className="mt-1 text-sm text-gray-500">All recruiters, all candidates, sorted by priority and wait time</p>

      {/* Platform-wide workload */}
      {workload && (
        <div className="mt-6 grid grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
            <p className="text-xl font-bold text-[#1C1B1A]">{workload.total}</p>
            <p className="text-[10px] text-gray-500 font-medium">Total</p>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center">
            <p className="text-xl font-bold text-red-700">{workload.red_count}</p>
            <p className="text-[10px] text-red-600 font-medium">Red (48h+)</p>
          </div>
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-center">
            <p className="text-xl font-bold text-yellow-700">{workload.yellow_count}</p>
            <p className="text-[10px] text-yellow-600 font-medium">Yellow (24-48h)</p>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center">
            <p className="text-xl font-bold text-green-700">{workload.green_count}</p>
            <p className="text-[10px] text-green-600 font-medium">Green (&lt;24h)</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
            <p className="text-xl font-bold text-[#1C1B1A]">{workload.avg_wait_hours}h</p>
            <p className="text-[10px] text-gray-500 font-medium">Avg Wait</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
            <p className="text-xl font-bold text-green-600">{workload.completed_this_week}</p>
            <p className="text-[10px] text-gray-500 font-medium">Done (Week)</p>
          </div>
        </div>
      )}

      {/* Recruiter breakdown cards */}
      {Object.keys(breakdown).length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">By Recruiter</h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedRecruiter(null)}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                !selectedRecruiter ? "border-[#FE6E3E] bg-orange-50 text-[#FE6E3E]" : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              All ({candidates.length})
            </button>
            {Object.values(breakdown)
              .sort((a, b) => b.red - a.red || b.avgWait - a.avgWait)
              .map((r) => (
                <button
                  key={r.recruiter}
                  onClick={() => setSelectedRecruiter(r.recruiter)}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    selectedRecruiter === r.recruiter
                      ? "border-[#FE6E3E] bg-orange-50 text-[#FE6E3E]"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {r.recruiter}
                  <span className="ml-1.5 text-gray-400">{r.count}</span>
                  {r.red > 0 && <span className="ml-1 text-red-600">({r.red} red)</span>}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Priority queue */}
      <div className="mt-6 space-y-2">
        {filteredCandidates.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No candidates match the current filter.</p>
        ) : (
          filteredCandidates.map((c) => (
            <div
              key={c.id}
              className={`rounded-lg border p-3 flex items-center gap-3 ${
                c.sla_status === "red" ? "border-red-200 bg-red-50" :
                c.sla_status === "yellow" ? "border-yellow-200 bg-yellow-50" :
                "border-gray-200 bg-white"
              }`}
            >
              <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${SLA_DOT[c.sla_status]}`} />

              <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-gray-100">
                {c.profile_photo_url ? (
                  <img src={c.profile_photo_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-gray-400">
                    {c.display_name?.[0] || "?"}
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#1C1B1A] truncate">{c.display_name}</p>
                <p className="text-[10px] text-gray-500">{c.country} · {c.role_category} · {c.assigned_recruiter || "Unassigned"}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {c.screening_tag && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                    c.screening_tag === "Priority" ? "bg-green-100 text-green-700" :
                    c.screening_tag === "Review" ? "bg-yellow-100 text-yellow-700" :
                    "bg-gray-100 text-gray-600"
                  }`}>
                    {c.screening_tag}
                  </span>
                )}
                <span className="text-[10px] text-gray-500 tabular-nums w-10 text-right">{c.wait_hours}h</span>
                <Link
                  href={`/candidate/${c.id}`}
                  className="text-[10px] font-medium text-[#FE6E3E] hover:underline"
                >
                  View
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
