"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

interface RoleRow {
  role: string;
  live: number;
  pending: number;
  pipelineRatio: number;
  stages: {
    applied: number;
    english_test: number;
    id_verification: number;
    profile_builder: number;
    ai_interview: number;
    second_interview: number;
    pending_approval: number;
  };
}

type SortKey = "role" | "live" | "pending" | "pipelineRatio";

const STAGE_LABELS: Record<string, string> = {
  applied: "Applied",
  english_test: "English Test",
  id_verification: "ID Verification",
  profile_builder: "Profile Builder",
  ai_interview: "AI Interview",
  second_interview: "Second Interview",
  pending_approval: "Pending Approval",
};

export default function TalentPoolPage() {
  const router = useRouter();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("live");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(0);

  const loadData = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push("/login"); return; }

    const role = session.user.user_metadata?.role;
    if (role !== "admin" && role !== "recruiting_manager") {
      router.push("/");
      return;
    }

    try {
      const res = await fetch("/api/talent-pool", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      setRoles(data.roles || []);
      setLastUpdated(data.lastUpdated);
    } catch (err) {
      console.error("Failed to load talent pool data:", err);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh every 15 minutes
  useEffect(() => {
    const interval = setInterval(loadData, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadData]);

  async function handleManualRefresh() {
    const now = Date.now();
    if (now - lastRefresh < 5 * 60 * 1000) return; // 5min rate limit
    setRefreshing(true);
    setLastRefresh(now);
    await loadData();
    setRefreshing(false);
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === "role");
    }
  }

  const sorted = [...roles].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "role") cmp = a.role.localeCompare(b.role);
    else if (sortKey === "live") cmp = a.live - b.live;
    else if (sortKey === "pending") cmp = a.pending - b.pending;
    else if (sortKey === "pipelineRatio") {
      const aR = a.pipelineRatio >= 9999 ? 9999 : a.pipelineRatio;
      const bR = b.pipelineRatio >= 9999 ? 9999 : b.pipelineRatio;
      cmp = aR - bR;
    }
    return sortAsc ? cmp : -cmp;
  });

  const minutesAgo = lastUpdated ? Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 60000) : null;

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" /></div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1B1A]">Talent Pool Health</h1>
          <p className="mt-1 text-sm text-gray-500">Live candidates available to clients versus candidates in the pipeline by role</p>
        </div>
        <div className="flex items-center gap-3">
          {minutesAgo != null && (
            <span className="text-[11px] text-gray-400">Updated {minutesAgo < 1 ? "just now" : `${minutesAgo}m ago`}</span>
          )}
          <button
            onClick={handleManualRefresh}
            disabled={refreshing || Date.now() - lastRefresh < 5 * 60 * 1000}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-[#FE6E3E] hover:text-[#FE6E3E] transition-colors disabled:opacity-40"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400 text-[10px] font-semibold uppercase">
                {([
                  { key: "role" as SortKey, label: "Role Category", align: "text-left" },
                  { key: "live" as SortKey, label: "Live", align: "text-center" },
                  { key: "pending" as SortKey, label: "Pipeline", align: "text-center" },
                  { key: "pipelineRatio" as SortKey, label: "Ratio", align: "text-center" },
                ]).map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={`px-4 py-3 cursor-pointer hover:text-[#1C1B1A] transition-colors ${col.align}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {sortKey === col.key && <span>{sortAsc ? "\u2191" : "\u2193"}</span>}
                    </span>
                  </th>
                ))}
                <th className="px-4 py-3 text-center">Health</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const isExpanded = expandedRole === row.role;
                const isOther = row.role === "Custom Roles (Unrouted)";
                const ratioColor = row.pipelineRatio >= 9999 ? "text-green-600"
                  : row.pipelineRatio < 2 ? "text-red-600"
                  : row.pipelineRatio < 4 ? "text-amber-500"
                  : "text-green-600";
                const barColor = row.pipelineRatio >= 9999 ? "bg-green-500"
                  : row.pipelineRatio < 2 ? "bg-red-500"
                  : row.pipelineRatio < 4 ? "bg-amber-400"
                  : "bg-green-500";
                const barWidth = row.pipelineRatio >= 9999 ? 100
                  : Math.min((row.pipelineRatio / 6) * 100, 100);

                return (
                  <React.Fragment key={row.role}>
                  <tr className="group border-b border-gray-50" onClick={() => setExpandedRole(isExpanded ? null : row.role)}>
                    <td className="px-4 py-3 text-left font-medium text-[#1C1B1A] cursor-pointer hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-2">
                        <svg className={`h-3 w-3 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                        <span>{row.role}</span>
                        {isOther && (
                          <Link href="/recruiter" className="text-[10px] text-[#FE6E3E] font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                            View queue
                          </Link>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center w-20 cursor-pointer hover:bg-gray-50 transition-colors">
                      <span className="text-sm font-bold text-green-600">{row.live}</span>
                    </td>
                    <td className="px-4 py-3 text-center w-20 cursor-pointer hover:bg-gray-50 transition-colors">
                      <span className="text-sm font-semibold text-gray-600">{row.pending}</span>
                    </td>
                    <td className="px-4 py-3 text-center w-20 cursor-pointer hover:bg-gray-50 transition-colors">
                      <span className={`text-sm font-bold ${ratioColor}`}>
                        {row.pipelineRatio >= 9999 ? "\u221e" : row.pipelineRatio.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3 w-32 cursor-pointer hover:bg-gray-50 transition-colors">
                      <div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barWidth}%` }} />
                      </div>
                    </td>
                  </tr>
                  {/* Expanded pipeline breakdown */}
                  {isExpanded && (
                    <tr key={`${row.role}-expanded`}>
                      <td colSpan={5} className="bg-gray-50 border-b border-gray-100 px-8 py-4">
                        <p className="text-[10px] text-gray-400 uppercase font-semibold mb-2">Pipeline Stage Breakdown</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                          {Object.entries(row.stages || {}).map(([stage, count]) => (
                            <div key={stage} className="rounded-lg border border-gray-200 bg-white p-3 text-center">
                              <p className="text-lg font-bold text-[#1C1B1A]">{count}</p>
                              <p className="text-[9px] text-gray-400 uppercase font-medium mt-0.5">{STAGE_LABELS[stage] || stage}</p>
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 text-[11px] text-gray-400">
                          Total pipeline: {Object.values(row.stages || {}).reduce((s, n) => s + n, 0)} (should equal {row.pending})
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-4 text-[10px] text-gray-400">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> Ratio &lt; 2.0 — needs recruiting focus</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> 2.0–4.0 — healthy</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" /> &gt; 4.0 — strong pipeline</span>
      </div>
    </div>
  );
}
