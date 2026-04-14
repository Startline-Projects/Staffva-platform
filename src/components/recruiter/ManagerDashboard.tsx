"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import RecruiterNotificationBell from "./RecruiterNotificationBell";
import RecruiterPhotoQueue from "@/components/admin/RecruiterPhotoQueue";

interface ManagerData {
  personalKpi: {
    interviewsToday: number;
    dailyTarget: number;
    recruiterType: string;
    socialPosts: { id: string; post_url: string; created_at: string }[];
    calendarLink: string | null;
    calendarValid: boolean | null;
  };
  teamSummary: {
    totalInterviewsToday: number;
    totalTarget: number;
    postingCompliance: { at2Posts: number; totalRecruiters: number };
    unroutedAlertCount: number;
  };
  teamStatus: {
    id: string;
    name: string;
    role: string;
    interviewsToday: number;
    dailyTarget: number;
    socialPostsToday: number;
    queueDepth: number;
    calendarLink: string | null;
    calendarValid: boolean;
  }[];
  unroutedQueue: {
    id: string;
    display_name: string;
    full_name: string;
    role_category: string;
    role_category_custom: string | null;
    profile_photo_url: string | null;
    screening_score: number | null;
    english_mc_score: number | null;
    created_at: string;
    english_written_tier: string | null;
  }[];
  unroutedAlerts: {
    id: string;
    candidate_id: string;
    ai_interview_result: boolean;
    created_at: string;
    candidate_name: string;
    role_category_custom: string | null;
  }[];
  managerNotifications: {
    id: string;
    message: string;
    candidate_id: string | null;
    recruiter_id: string | null;
    created_at: string;
    read_at: string | null;
  }[];
  recentGoLives: {
    id: string;
    display_name: string;
    full_name: string;
    role_category: string;
    profile_photo_url: string | null;
    profile_went_live_at: string;
    assigned_recruiter: string | null;
    recruiter_name: string;
  }[];
  banQueue: {
    id: string;
    display_name: string;
    full_name: string;
    role_category: string;
    ban_reason: string;
    ban_requested_by: string;
    ban_requested_by_name: string;
    ban_requested_at: string;
  }[];
  stalledRevisions: {
    id: string;
    candidate_id: string;
    items: { type: string; note?: string }[];
    created_at: string;
    candidates: { id: string; display_name: string; full_name: string; role_category: string; profile_photo_url: string | null };
  }[];
  metrics: {
    approvedThisWeek: number;
    topRevisionItems: { type: string; count: number }[];
    weeklyPostingCompliance: number;
  };
  complianceGrid: {
    recruiterId: string;
    recruiterName: string;
    days: { date: string; count: number }[];
  }[];
  gridDays: string[];
  recruiterNameMap: Record<string, string>;
  calendarAlerts: {
    id: string;
    recruiter_id: string;
    recruiter_name: string;
    alerted_at: string;
  }[];
  myQueue: {
    id: string;
    display_name: string;
    role_category: string;
    admin_status: string;
    screening_tag: string;
    country: string;
    updated_at: string;
    created_at: string;
  }[];
  allCandidates: {
    id: string;
    display_name: string;
    role_category: string;
    admin_status: string;
    screening_tag: string;
    country: string;
    updated_at: string;
    created_at: string;
    assigned_recruiter: string | null;
    assigned_recruiter_name: string;
  }[];
}

function stageBadge(status: string, tag: string | null) {
  if (tag === "assignment_pending_review") return { label: "Needs routing", cls: "bg-red-100 text-red-700" };
  switch (status) {
    case "pending_speaking_review": return { label: "Pending review", cls: "bg-amber-100 text-amber-700" };
    case "approved": return { label: "Approved", cls: "bg-green-100 text-green-700" };
    case "revision_required": return { label: "Revision", cls: "bg-orange-100 text-orange-700" };
    case "profile_review": return { label: "Profile review", cls: "bg-blue-100 text-blue-700" };
    default: return { label: status?.replace(/_/g, " ") || "Unknown", cls: "bg-gray-100 text-gray-600" };
  }
}

function daysAgo(dateStr: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)));
}

function isThisWeek(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const day = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  weekStart.setHours(0, 0, 0, 0);
  return d >= weekStart;
}

export default function ManagerDashboard() {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<"manager" | "ts">("manager");
  const [data, setData] = useState<ManagerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [candidatesSearch, setCandidatesSearch] = useState("");
  const [tsSearch, setTsSearch] = useState("");
  const [dismissedCalendarAlerts, setDismissedCalendarAlerts] = useState<Set<string>>(new Set());
  const [assignModal, setAssignModal] = useState<{ candidateId: string; name: string } | null>(null);
  const [selectedRecruiterId, setSelectedRecruiterId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [expandedReassignId, setExpandedReassignId] = useState<string | null>(null);
  const [reassignPickedId, setReassignPickedId] = useState("");

  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => { setLoading(false); setLoadError(true); }, 10000);
    return () => clearTimeout(timer);
  }, [loading]);

  const loadDashboard = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push("/login"); return; }
    setToken(session.access_token);
    setCurrentUserId(session.user.id);

    try {
      const res = await fetch("/api/recruiting-manager/dashboard", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 401 || res.status === 403) { setLoading(false); setAuthError(true); return; }
      if (res.ok) {
        const dashboardData = await res.json();
        console.log("[MANAGER DASH CLIENT] allCandidates:", dashboardData?.allCandidates?.length, "myQueue:", dashboardData?.myQueue?.length);
        setData(dashboardData);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [router]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  async function handleInlineAssign(candidateId: string, newRecruiterId: string) {
    if (!newRecruiterId || !data) return;
    const recruiterName = data.recruiterNameMap[newRecruiterId] || "Unknown";

    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        allCandidates: prev.allCandidates.map((c) =>
          c.id === candidateId ? { ...c, assigned_recruiter: newRecruiterId, assigned_recruiter_name: recruiterName } : c
        ),
        myQueue: prev.myQueue.filter((c) => c.id !== candidateId || newRecruiterId === currentUserId),
      };
    });

    setSavedIds((prev) => new Set(prev).add(candidateId));
    setTimeout(() => setSavedIds((prev) => { const next = new Set(prev); next.delete(candidateId); return next; }), 2000);

    try {
      await fetch("/api/recruiter/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ candidateId, newRecruiterId }),
      });
    } catch {
      loadDashboard();
    }
  }

  async function handleAssign(candidateId: string, recruiterId: string) {
    setAssigning(true);
    try {
      const res = await fetch("/api/recruiter/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ candidateId, newRecruiterId: recruiterId }),
      });
      if (res.ok) { setAssignModal(null); setSelectedRecruiterId(""); loadDashboard(); }
    } catch { /* silent */ }
    setAssigning(false);
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" /></div>;
  }
  if (authError) {
    return <div className="flex flex-col items-center justify-center py-20 gap-3"><p className="text-gray-500">Session error. Please sign out and sign back in.</p></div>;
  }
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-gray-500">{loadError ? "Unable to load dashboard. Please refresh." : "Failed to load dashboard"}</p>
        <button onClick={() => { setLoadError(false); setLoading(true); loadDashboard(); }} className="rounded-lg bg-[#FE6E3E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#E55A2B]">Retry</button>
      </div>
    );
  }

  // Derived counts
  const allCandidates = data.allCandidates || [];
  const myQueue = data.myQueue || [];
  const totalCandidates = allCandidates.length;
  const approvedThisWeek = data.metrics.approvedThisWeek;
  const pendingSpeakingReview = allCandidates.filter((c) => c.admin_status === "pending_speaking_review").length;
  const needsRouting = allCandidates.filter((c) => c.screening_tag === "assignment_pending_review").length;

  // Pipeline counts
  const pipelineRows = [
    { label: "Total applications", count: totalCandidates, color: "bg-gray-400" },
    { label: "Profile review", count: allCandidates.filter((c) => c.admin_status === "profile_review").length, color: "bg-blue-500" },
    { label: "Pending speaking review", count: pendingSpeakingReview, color: "bg-amber-500" },
    { label: "Approved & live", count: allCandidates.filter((c) => c.admin_status === "approved").length, color: "bg-green-500" },
    { label: "Needs routing", count: needsRouting, color: "bg-[#FE6E3E]" },
  ];

  // TS view counts
  const myActionNeeded = myQueue.filter((c) => c.admin_status === "pending_speaking_review" || c.screening_tag === "assignment_pending_review");
  const myApprovedThisWeek = myQueue.filter((c) => c.admin_status === "approved" && isThisWeek(c.updated_at)).length;
  const myNeedsRouting = myQueue.filter((c) => c.screening_tag === "assignment_pending_review").length;

  // Alerts
  const routingAlert = needsRouting > 0;
  const calendarAlerts = (data.calendarAlerts || []).filter((a) => !dismissedCalendarAlerts.has(a.id));
  const missingCalendarRecruiters = data.teamStatus.filter((r) => !r.calendarLink);

  // Sorted all candidates: needs routing first, then by created_at desc
  const filteredCandidates = allCandidates
    .filter((c) => {
      if (!candidatesSearch) return true;
      const q = candidatesSearch.toLowerCase();
      return (c.display_name || "").toLowerCase().includes(q) || (c.role_category || "").toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const aRouting = a.screening_tag === "assignment_pending_review" ? 0 : 1;
      const bRouting = b.screening_tag === "assignment_pending_review" ? 0 : 1;
      if (aRouting !== bRouting) return aRouting - bRouting;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    })
    .slice(0, 50);

  // TS filtered
  const filteredMyQueue = myQueue
    .filter((c) => {
      if (!tsSearch) return true;
      const q = tsSearch.toLowerCase();
      return (c.display_name || "").toLowerCase().includes(q) || (c.role_category || "").toLowerCase().includes(q);
    })
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ── */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-3">
        <div className="mx-auto max-w-7xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-[#FE6E3E] flex items-center justify-center text-white text-sm font-bold shrink-0">MA</div>
            <div>
              <p className="text-sm font-semibold text-[#1C1B1A]">Manar</p>
              <p className="text-[11px] text-gray-400">Recruiting Manager &middot; Talent Specialist</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-gray-100 rounded-full p-[3px]">
              <button onClick={() => setViewMode("manager")} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${viewMode === "manager" ? "bg-[#FE6E3E] text-white shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>Manager</button>
              <button onClick={() => setViewMode("ts")} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${viewMode === "ts" ? "bg-[#FE6E3E] text-white shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>Talent Specialist</button>
            </div>
            <RecruiterNotificationBell token={token} />
          </div>
        </div>
      </div>

      {viewMode === "manager" ? (
        /* ═══════════════════ MANAGER VIEW ═══════════════════ */
        <div className="mx-auto max-w-7xl px-4 py-4 space-y-6">

          {/* ── Metric cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <p className="text-2xl font-medium text-[#1C1B1A]">{totalCandidates}</p>
              <p className="text-xs text-gray-500 mt-1">Total candidates</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <p className="text-2xl font-medium text-green-600">{approvedThisWeek}</p>
              <p className="text-xs text-gray-500 mt-1">Approved this week</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <p className="text-2xl font-medium text-amber-600">{pendingSpeakingReview}</p>
              <p className="text-xs text-gray-500 mt-1">Pending speaking review</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <p className="text-2xl font-medium text-[#1C1B1A]">
                {needsRouting}
                {needsRouting > 0 && <span className="inline-block ml-1.5 h-2 w-2 rounded-full bg-red-500 align-middle" />}
              </p>
              <p className="text-xs text-gray-500 mt-1">Needs routing</p>
            </div>
          </div>

          {/* ── Pipeline funnel ── */}
          <section>
            <h2 className="text-sm font-semibold text-[#1C1B1A] mb-3">Pipeline</h2>
            <div className="space-y-2">
              {pipelineRows.map((row) => {
                const pct = totalCandidates > 0 ? Math.max(2, (row.count / totalCandidates) * 100) : 0;
                return (
                  <div key={row.label} className="flex items-center gap-3">
                    <span className="w-40 text-xs text-gray-500 text-right shrink-0">{row.label}</span>
                    <div className="flex-1 bg-gray-100 rounded h-5 overflow-hidden">
                      <div className={`${row.color} h-full rounded flex items-center transition-all`} style={{ width: `${pct}%` }}>
                        {pct > 15 && <span className="text-[10px] font-semibold text-white pl-2">{row.count}</span>}
                      </div>
                    </div>
                    {pct <= 15 && <span className="text-[10px] font-semibold text-gray-500 shrink-0">{row.count}</span>}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Two-column: Alerts | Team performance ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: Alerts */}
            <section>
              <h2 className="text-sm font-semibold text-[#1C1B1A] mb-3">Alerts</h2>
              <div className="space-y-2">
                {routingAlert && (
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-orange-800 font-medium">{needsRouting} candidate{needsRouting !== 1 ? "s" : ""} need routing — in your queue, awaiting review.</p>
                    <button onClick={() => setViewMode("ts")} className="shrink-0 rounded-lg bg-[#FE6E3E] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#E55A2B]">Switch to TS view</button>
                  </div>
                )}
                {calendarAlerts.map((alert) => (
                  <div key={alert.id} className="rounded-lg border border-blue-200 bg-blue-50 p-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-blue-800 font-medium">{alert.recruiter_name} removed their calendar link. Candidates cannot book second interview.</p>
                    <button
                      onClick={async () => {
                        setDismissedCalendarAlerts((prev) => new Set(prev).add(alert.id));
                        await fetch("/api/admin/calendar-alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alert_id: alert.id }) });
                      }}
                      className="shrink-0 rounded-lg border border-blue-300 bg-white px-3 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
                    >Dismiss</button>
                  </div>
                ))}
                {missingCalendarRecruiters.map((r) => (
                  <div key={r.id} className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <p className="text-xs text-blue-800 font-medium">{r.name} — calendar link missing. Candidates cannot book second interview.</p>
                  </div>
                ))}
                {data.unroutedAlerts.length > 0 && data.unroutedAlerts.map((alert) => (
                  <div key={alert.id} className="rounded-lg border border-orange-200 bg-orange-50 p-3 flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500 text-white text-[10px] font-bold">!</span>
                    <p className="text-xs text-orange-800 font-medium">{alert.candidate_name} ({alert.role_category_custom || "Other"}) — needs recruiter assignment</p>
                  </div>
                ))}
                {!routingAlert && calendarAlerts.length === 0 && missingCalendarRecruiters.length === 0 && data.unroutedAlerts.length === 0 && (
                  <p className="text-xs text-gray-400 py-4 text-center">No alerts — team is on track.</p>
                )}
              </div>
            </section>

            {/* Right: Team performance */}
            <section>
              <h2 className="text-sm font-semibold text-[#1C1B1A] mb-3">Team Performance</h2>
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400 uppercase text-[10px] font-medium">
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-center">Queue</th>
                      <th className="px-3 py-2 text-center">Interviews</th>
                      <th className="px-3 py-2 text-center">Posts</th>
                      <th className="px-3 py-2 text-center">Cal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.teamStatus.map((r) => (
                      <tr key={r.id} className="border-b border-gray-50">
                        <td className="px-3 py-2 font-medium text-[#1C1B1A]">{r.name}</td>
                        <td className="px-3 py-2 text-center text-gray-600">{r.queueDepth}</td>
                        <td className="px-3 py-2 text-center text-gray-600">{r.interviewsToday}/{r.dailyTarget || 14}</td>
                        <td className="px-3 py-2 text-center text-gray-600">{r.socialPostsToday}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-block h-2.5 w-2.5 rounded-full ${r.calendarValid ? "bg-green-500" : "bg-red-500"}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* ── All candidates assignment table ── */}
          <section>
            <div className="flex items-center justify-between mb-3 gap-3">
              <h2 className="text-sm font-semibold text-[#1C1B1A]">All Candidates</h2>
              <input
                type="text"
                value={candidatesSearch}
                onChange={(e) => setCandidatesSearch(e.target.value)}
                placeholder="Search name or role..."
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E] w-56"
              />
            </div>
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400 uppercase text-[10px] font-medium">
                      <th className="px-4 py-2.5 text-left">Candidate</th>
                      <th className="px-4 py-2.5 text-left">Role</th>
                      <th className="px-4 py-2.5 text-left">Stage</th>
                      <th className="px-4 py-2.5 text-left">Assigned to</th>
                      <th className="px-4 py-2.5 text-center">Waiting</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCandidates.map((c) => {
                      const badge = stageBadge(c.admin_status, c.screening_tag);
                      const waiting = daysAgo(c.updated_at);
                      return (
                        <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-2.5 font-medium text-[#1C1B1A]">{c.display_name || "—"}</td>
                          <td className="px-4 py-2.5 text-gray-500">{c.role_category || "—"}</td>
                          <td className="px-4 py-2.5">
                            <span className={`${badge.cls} text-[10px] font-medium px-2 py-0.5 rounded-full`}>{badge.label}</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <select
                                value={c.assigned_recruiter || ""}
                                onChange={(e) => handleInlineAssign(c.id, e.target.value)}
                                className="rounded border border-gray-200 px-2 py-1 text-xs bg-white focus:border-[#FE6E3E] focus:outline-none max-w-[140px]"
                              >
                                <option value="">Unassigned</option>
                                {data.teamStatus.map((r) => (
                                  <option key={r.id} value={r.id}>{r.name}</option>
                                ))}
                              </select>
                              {savedIds.has(c.id) && <span className="text-[10px] text-green-600 font-medium animate-pulse">&#10003; Saved</span>}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-center text-gray-400">{waiting}d</td>
                          <td className="px-4 py-2.5 text-right">
                            <Link href={`/candidate/${c.id}`} className="rounded-lg border border-gray-200 px-2.5 py-1 text-[10px] font-medium text-[#1C1B1A] hover:border-[#FE6E3E] hover:text-[#FE6E3E] transition-colors">View</Link>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredCandidates.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400 text-xs">No candidates match your search.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ── Posting compliance grid (existing) ── */}
          <section>
            <h2 className="text-sm font-semibold text-[#1C1B1A] mb-3">Posting Compliance Grid</h2>
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400 text-[10px] font-medium uppercase">
                      <th className="px-4 py-2 text-left">Recruiter</th>
                      {data.gridDays.map((day) => {
                        const d = new Date(day + "T12:00:00");
                        const isToday = day === new Date().toISOString().split("T")[0];
                        return <th key={day} className={`px-3 py-2 text-center ${isToday ? "bg-orange-50" : ""}`}>{d.toLocaleDateString("en-US", { weekday: "short" })}</th>;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {data.complianceGrid.map((row) => (
                      <tr key={row.recruiterId} className="border-b border-gray-50">
                        <td className="px-4 py-2 font-medium text-[#1C1B1A]">{row.recruiterName}</td>
                        {row.days.map((day, i) => {
                          const isToday = data.gridDays[i] === new Date().toISOString().split("T")[0];
                          return (
                            <td key={i} className={`px-3 py-2 text-center ${isToday ? "bg-orange-50" : ""}`}>
                              <span className={`font-semibold ${day.count >= 2 ? "text-green-600" : day.count === 1 ? "text-amber-500" : "text-gray-300"}`}>{day.count}</span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ── Unrouted queue with assign buttons ── */}
          {data.unroutedQueue.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold text-[#1C1B1A]">Needs Assignment</h2>
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{data.unroutedQueue.length}</span>
              </div>
              <div className="space-y-3">
                {data.unroutedQueue.map((c) => (
                  <div key={c.id} className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-100">
                        {c.profile_photo_url ? <img src={c.profile_photo_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-xs font-bold text-gray-400">{(c.display_name || c.full_name)?.[0]}</div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#1C1B1A]">{c.display_name || c.full_name}</p>
                        <p className="text-base font-bold text-[#FE6E3E] mt-0.5">{c.role_category_custom || "Custom role"}</p>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
                          {c.screening_score != null && <span>AI: {c.screening_score}/10</span>}
                          {c.english_written_tier && <span>English: {c.english_written_tier}</span>}
                          <span className={daysAgo(c.created_at) > 2 ? "text-red-500 font-semibold" : ""}>{daysAgo(c.created_at)}d waiting</span>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <button onClick={() => handleAssign(c.id, currentUserId)} className="rounded-lg bg-[#FE6E3E] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#E55A2B]">Assign to Me</button>
                          <button onClick={() => { setAssignModal({ candidateId: c.id, name: c.display_name || c.full_name }); setSelectedRecruiterId(""); }} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-[#1C1B1A] hover:border-[#FE6E3E] hover:text-[#FE6E3E]">Assign to Recruiter</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Ban queue ── */}
          {data.banQueue.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold text-[#1C1B1A]">Ban Requests</h2>
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{data.banQueue.length}</span>
              </div>
              <div className="space-y-3">
                {data.banQueue.map((c) => (
                  <div key={c.id} className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <p className="text-sm font-semibold text-[#1C1B1A]">{c.display_name || c.full_name}</p>
                    <p className="text-[11px] text-gray-500">{c.role_category} &middot; Requested by {c.ban_requested_by_name}</p>
                    <p className="mt-2 text-sm text-red-800 bg-red-100 rounded-lg p-3">{c.ban_reason}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Stalled revisions ── */}
          {data.stalledRevisions.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold text-[#1C1B1A]">Stalled Revisions (&gt;72h)</h2>
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">{data.stalledRevisions.length}</span>
              </div>
              <div className="space-y-3">
                {data.stalledRevisions.map((rev) => {
                  const c = rev.candidates;
                  return (
                    <div key={rev.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                      <div className="flex items-start gap-3">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-100">
                          {c.profile_photo_url ? <img src={c.profile_photo_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-xs font-bold text-gray-400">{(c.display_name || c.full_name)?.[0]}</div>}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-[#1C1B1A]">{c.display_name || c.full_name}</p>
                          <p className="text-[11px] text-gray-500">{c.role_category} &middot; <span className="text-red-500 font-semibold">{daysAgo(rev.created_at)}d stalled</span></p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {rev.items.map((item, i) => (
                              <span key={i} className="rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-[10px] text-amber-700">{item.type.split(" — ")[0]}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Recent go-lives ── */}
          {data.recentGoLives.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-[#1C1B1A] mb-3">Recent Go-Lives</h2>
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100">
                {data.recentGoLives.map((c) => {
                  const mins = Math.floor((Date.now() - new Date(c.profile_went_live_at).getTime()) / 60000);
                  const timeAgo = mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`;
                  return (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-gray-100">
                        {c.profile_photo_url ? <img src={c.profile_photo_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-gray-400">{(c.display_name || c.full_name)?.[0]}</div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#1C1B1A] truncate">{c.display_name || c.full_name}</p>
                        <p className="text-[10px] text-gray-500">{c.role_category} &middot; via {c.recruiter_name}</p>
                      </div>
                      <span className="text-[10px] text-gray-400 shrink-0">{timeAgo}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Recruiter photo queue ── */}
          {token && currentUserId && (
            <section>
              <h2 className="text-sm font-semibold text-[#1C1B1A] mb-3">Recruiter Photos — Pending Approval</h2>
              <RecruiterPhotoQueue token={token} currentUserId={currentUserId} currentUserRole="recruiting_manager" />
            </section>
          )}
        </div>
      ) : (
        /* ═══════════════════ TALENT SPECIALIST VIEW ═══════════════════ */
        <div className="mx-auto max-w-7xl px-4 py-4 space-y-6">

          {/* ── TS Metric cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <p className="text-2xl font-medium text-[#1C1B1A]">{myQueue.length}</p>
              <p className="text-xs text-gray-500 mt-1">My assigned candidates</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <p className="text-2xl font-medium text-amber-600">{myActionNeeded.length}</p>
              <p className="text-xs text-gray-500 mt-1">Action needed</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <p className="text-2xl font-medium text-green-600">{myApprovedThisWeek}</p>
              <p className="text-xs text-gray-500 mt-1">Approved this week</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <p className="text-2xl font-medium text-[#1C1B1A]">
                {myNeedsRouting}
                {myNeedsRouting > 0 && <span className="inline-block ml-1.5 h-2 w-2 rounded-full bg-red-500 align-middle" />}
              </p>
              <p className="text-xs text-gray-500 mt-1">Needs routing</p>
            </div>
          </div>

          {/* ── Action needed queue ── */}
          {myActionNeeded.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-[#1C1B1A] mb-3">Action Needed</h2>
              <div className="space-y-2">
                {myActionNeeded
                  .sort((a, b) => {
                    const aPri = a.screening_tag === "assignment_pending_review" ? 0 : 1;
                    const bPri = b.screening_tag === "assignment_pending_review" ? 0 : 1;
                    return aPri - bPri;
                  })
                  .map((c) => {
                    const isRouting = c.screening_tag === "assignment_pending_review";
                    const isPendingReview = c.admin_status === "pending_speaking_review";
                    const statusText = isRouting
                      ? "Needs routing — review and reassign"
                      : isPendingReview
                      ? "Speaking review ready"
                      : "Action required";
                    const initials = (c.display_name || "??").slice(0, 2).toUpperCase();
                    return (
                      <div key={c.id} className={`rounded-lg border p-4 ${isRouting ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
                        <div className="flex items-center gap-3">
                          <div className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-sm font-bold text-white ${isRouting ? "bg-red-400" : "bg-amber-400"}`}>{initials}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[#1C1B1A]">{c.display_name}</p>
                            <p className="text-[11px] text-gray-500">{c.role_category} &middot; {statusText} &middot; {daysAgo(c.updated_at)}d waiting</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Link href={`/candidate/${c.id}`} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-[#1C1B1A] hover:border-[#FE6E3E] hover:text-[#FE6E3E] transition-colors">View profile</Link>
                            {isRouting && (
                              expandedReassignId === c.id ? (
                                <div className="flex items-center gap-1">
                                  <select
                                    value={reassignPickedId}
                                    onChange={(e) => setReassignPickedId(e.target.value)}
                                    className="rounded border border-gray-200 px-2 py-1 text-xs bg-white focus:border-[#FE6E3E] focus:outline-none"
                                  >
                                    <option value="">Pick TS...</option>
                                    {data.teamStatus.map((r) => (
                                      <option key={r.id} value={r.id}>{r.name}</option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => { if (reassignPickedId) { handleInlineAssign(c.id, reassignPickedId); setExpandedReassignId(null); setReassignPickedId(""); } }}
                                    disabled={!reassignPickedId}
                                    className="rounded-lg bg-[#FE6E3E] px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-[#E55A2B] disabled:opacity-50"
                                  >Confirm</button>
                                  <button onClick={() => { setExpandedReassignId(null); setReassignPickedId(""); }} className="text-gray-400 hover:text-gray-600 text-xs">&times;</button>
                                </div>
                              ) : (
                                <button onClick={() => { setExpandedReassignId(c.id); setReassignPickedId(""); }} className="rounded-lg bg-[#FE6E3E] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#E55A2B]">Reassign</button>
                              )
                            )}
                            {isPendingReview && (
                              <Link href={`/admin/candidates?status=pending_speaking_review`} className="rounded-lg bg-[#FE6E3E] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#E55A2B]">Review</Link>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </section>
          )}

          {/* ── All my candidates ── */}
          <section>
            <div className="flex items-center justify-between mb-3 gap-3">
              <h2 className="text-sm font-semibold text-[#1C1B1A]">All My Candidates</h2>
              <input
                type="text"
                value={tsSearch}
                onChange={(e) => setTsSearch(e.target.value)}
                placeholder="Search name or role..."
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E] w-56"
              />
            </div>
            <div className="space-y-2">
              {filteredMyQueue.map((c) => {
                const badge = stageBadge(c.admin_status, c.screening_tag);
                const initials = (c.display_name || "??").slice(0, 2).toUpperCase();
                return (
                  <div key={c.id} className="rounded-lg border border-gray-200 bg-white p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-500">{initials}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#1C1B1A]">{c.display_name}</p>
                        <p className="text-[11px] text-gray-500">{c.role_category} &middot; <span className={`${badge.cls} text-[10px] font-medium px-2 py-0.5 rounded-full`}>{badge.label}</span> &middot; {daysAgo(c.updated_at)}d ago</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Link href={`/candidate/${c.id}`} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-medium text-[#1C1B1A] hover:border-[#FE6E3E] hover:text-[#FE6E3E] transition-colors">View profile</Link>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredMyQueue.length === 0 && (
                <p className="text-xs text-gray-400 py-6 text-center">No candidates assigned to you.</p>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ═══════════════════ MODALS ═══════════════════ */}

      {/* Assign modal (for unrouted queue) */}
      {assignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAssignModal(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[#1C1B1A]">Assign Candidate</h2>
            <p className="mt-1 text-sm text-gray-500">Route <strong>{assignModal.name}</strong> to a recruiter.</p>
            <select
              value={selectedRecruiterId}
              onChange={(e) => setSelectedRecruiterId(e.target.value)}
              className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E]"
            >
              <option value="">Choose recruiter...</option>
              {data.teamStatus.map((r) => (
                <option key={r.id} value={r.id}>{r.name} ({r.queueDepth} in queue)</option>
              ))}
            </select>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setAssignModal(null)} className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-[#1C1B1A] hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => handleAssign(assignModal.candidateId, selectedRecruiterId)}
                disabled={assigning || !selectedRecruiterId}
                className="flex-1 rounded-lg bg-[#FE6E3E] py-2.5 text-sm font-semibold text-white hover:bg-[#E55A2B] disabled:opacity-50"
              >
                {assigning ? "Assigning..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
