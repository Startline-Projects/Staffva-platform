"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import KpiStrip from "./KpiStrip";
import Link from "next/link";
import Lane1Resumes from "./Lane1Resumes";
import Lane2Profiles from "./Lane2Profiles";
import Lane3Revisions from "./Lane3Revisions";
import RevisionModal from "./RevisionModal";
import MessageSidebar from "./MessageSidebar";
import RecruiterNotificationBell from "./RecruiterNotificationBell";
import ReassignModal from "@/components/admin/ReassignModal";
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
}

type MobileTab = "mine" | "team";

export default function ManagerDashboard() {
  const router = useRouter();
  const [data, setData] = useState<ManagerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [mobileTab, setMobileTab] = useState<MobileTab>("team");
  const [revisionModal, setRevisionModal] = useState<{ candidateId: string; name: string } | null>(null);
  const [assignModal, setAssignModal] = useState<{ candidateId: string; name: string } | null>(null);
  const [selectedRecruiterId, setSelectedRecruiterId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [reassignModal, setReassignModal] = useState<{
    candidateId: string;
    candidateName: string;
    currentRecruiterId: string | null;
  } | null>(null);
  const [allCandidates, setAllCandidates] = useState<{
    id: string;
    display_name: string;
    email: string;
    role_category: string;
    admin_status: string;
    assigned_recruiter: string | null;
    recruiter_name: string | null;
    created_at: string;
  }[]>([]);
  const [candidatesSearch, setCandidatesSearch] = useState("");
  const [candidatesRecruiterFilter, setCandidatesRecruiterFilter] = useState("");
  const [candidatesLoaded, setCandidatesLoaded] = useState(false);

  // 10-second timeout fallback — never leave the spinner hanging
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      setLoading(false);
      setLoadError(true);
    }, 10000);
    return () => clearTimeout(timer);
  }, [loading]);

  // Personal recruiter data (for "Mine" tab)
  const [personalData, setPersonalData] = useState<{
    lane1: never[];
    lane2: never[];
    lane3: never[];
    threads: never[];
  } | null>(null);

  const loadDashboard = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push("/login"); return; }
    setToken(session.access_token);
    setCurrentUserId(session.user.id);

    try {
      const [managerRes, recruiterRes] = await Promise.all([
        fetch("/api/recruiting-manager/dashboard", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch("/api/recruiter/dashboard", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ]);
      if (managerRes.status === 401 || managerRes.status === 403) {
        setLoading(false);
        setAuthError(true);
        return;
      }
      if (managerRes.ok) setData(await managerRes.json());
      if (recruiterRes.ok) setPersonalData(await recruiterRes.json());
    } catch { /* silent */ }
    setLoading(false);
    loadAllCandidates(session.access_token);
  }, [router]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  async function loadAllCandidates(tok: string) {
    if (!tok) return;
    const res = await fetch("/api/admin/reassign/candidates", {
      headers: { Authorization: `Bearer ${tok}` },
    });
    if (res.ok) {
      const data = await res.json();
      setAllCandidates(data.candidates || []);
    }
    setCandidatesLoaded(true);
  }

  async function handleAssign(candidateId: string, recruiterId: string, isSelf: boolean) {
    setAssigning(true);
    try {
      const res = await fetch("/api/recruiter/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ candidateId, newRecruiterId: recruiterId }),
      });
      if (res.ok) {
        setAssignModal(null);
        setSelectedRecruiterId("");
        loadDashboard();
      }
    } catch { /* silent */ }
    setAssigning(false);
  }

  async function handleCalendarSave(link: string) {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase.from("profiles").update({ calendar_link: link || null }).eq("id", session.user.id);
    loadDashboard();
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" /></div>;
  }

  if (authError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-gray-500">Session error. Please sign out and sign back in.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-gray-500">{loadError ? "Unable to load dashboard. Please refresh." : "Failed to load dashboard"}</p>
        <button onClick={() => { setLoadError(false); setLoading(true); loadDashboard(); }} className="rounded-lg bg-[#FE6E3E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#E55A2B]">
          Retry
        </button>
      </div>
    );
  }

  const candidateMap = new Map<string, { name: string; photo: string | null }>();
  for (const c of data.unroutedQueue) candidateMap.set(c.id, { name: c.display_name || c.full_name, photo: c.profile_photo_url });
  for (const c of data.recentGoLives) candidateMap.set(c.id, { name: c.display_name || c.full_name, photo: c.profile_photo_url });

  const teamView = (
    <>
      {/* Split Header */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-3">
        <div className="mx-auto max-w-7xl flex flex-wrap gap-6 items-center justify-between">
          {/* Personal KPI (left) */}
          <div className="flex items-center gap-4">
            <KpiStrip kpi={data.personalKpi} token={token} onCalendarSaved={handleCalendarSave} onPostLogged={loadDashboard} />
          </div>
          {/* Team Summary (right) */}
          <div className="flex items-center gap-4">
            <div className="text-center px-3">
              <p className="text-lg font-bold text-[#1C1B1A]">{data.teamSummary.totalInterviewsToday}<span className="text-sm text-gray-400">/{data.teamSummary.totalTarget}</span></p>
              <p className="text-[10px] text-gray-400 uppercase font-medium">Team Interviews</p>
            </div>
            <div className="text-center px-3">
              <p className="text-lg font-bold text-[#1C1B1A]">{data.teamSummary.postingCompliance.at2Posts}<span className="text-sm text-gray-400">/{data.teamSummary.postingCompliance.totalRecruiters}</span></p>
              <p className="text-[10px] text-gray-400 uppercase font-medium">Posts Complete</p>
            </div>
            {data.teamSummary.unroutedAlertCount > 0 && (
              <div className="text-center px-3">
                <p className="text-lg font-bold text-red-600">{data.teamSummary.unroutedAlertCount}</p>
                <p className="text-[10px] text-red-500 uppercase font-semibold">Urgent Alerts</p>
              </div>
            )}
            <Link href="/talent-pool" className="text-center px-3 hover:opacity-80 transition-opacity">
              <p className="text-[10px] text-[#FE6E3E] font-semibold uppercase">Talent Pool</p>
              <p className="text-[10px] text-gray-400">Health &rarr;</p>
            </Link>
            <RecruiterNotificationBell token={token} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-4 space-y-6">
        {/* Team Status Bar */}
        <section>
          <h2 className="text-sm font-semibold text-[#1C1B1A] mb-3">Team Status</h2>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-400 uppercase text-[10px] font-medium">
                    <th className="px-4 py-2.5 text-left">Recruiter</th>
                    <th className="px-4 py-2.5 text-center">Interviews</th>
                    <th className="px-4 py-2.5 text-center">Posts</th>
                    <th className="px-4 py-2.5 text-center">Queue</th>
                    <th className="px-4 py-2.5 text-center">Calendar</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.teamStatus]
                    .sort((a, b) => {
                      const aTarget = typeof a.dailyTarget === "number" && a.dailyTarget > 0 ? a.dailyTarget : 14;
                      const bTarget = typeof b.dailyTarget === "number" && b.dailyTarget > 0 ? b.dailyTarget : 14;
                      const aRatio = a.interviewsToday / aTarget;
                      const bRatio = b.interviewsToday / bTarget;
                      return aRatio - bRatio;
                    })
                    .map((r) => {
                      const rTarget = typeof r.dailyTarget === "number" && r.dailyTarget > 0 ? r.dailyTarget : 14;
                      const pace = r.interviewsToday / rTarget;
                      const isNoon = new Date().getHours() >= 12;
                      const rowColor = pace < 0.5 ? "bg-red-50" : pace < 0.8 ? "bg-amber-50" : "";
                      return (
                        <tr key={r.id} className={`border-b border-gray-50 ${rowColor}`}>
                          <td className="px-4 py-2.5 font-medium text-[#1C1B1A]">{r.name}</td>
                          <td className="px-4 py-2.5 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <div className="w-16 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(pace * 100, 100)}%`, backgroundColor: pace >= 0.8 ? "#22c55e" : pace >= 0.5 ? "#f59e0b" : "#ef4444" }} />
                              </div>
                              <span className="text-[10px] text-gray-500">{r.interviewsToday}/{rTarget}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {[0, 1].map((i) => (
                                <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < r.socialPostsToday ? "bg-[#FE6E3E]" : "border border-gray-300"}`} />
                              ))}
                              {isNoon && r.socialPostsToday === 0 && <span className="text-[9px] text-red-500 ml-1">!</span>}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-center text-gray-600">{r.queueDepth}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`h-2.5 w-2.5 inline-block rounded-full ${r.calendarValid ? "bg-green-500" : "bg-red-500"}`} />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Unrouted Queue */}
        {data.unroutedQueue.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-[#1C1B1A]">Needs Assignment</h2>
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{data.unroutedQueue.length}</span>
            </div>
            <div className="space-y-3">
              {data.unroutedQueue.map((c) => {
                const daysWaiting = Math.floor((Date.now() - new Date(c.created_at).getTime()) / (1000 * 60 * 60 * 24));
                return (
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
                          <span className={daysWaiting > 2 ? "text-red-500 font-semibold" : ""}>{daysWaiting}d waiting</span>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => handleAssign(c.id, "", true)}
                            className="rounded-lg bg-[#FE6E3E] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#E55A2B]"
                          >
                            Assign to Me
                          </button>
                          <button
                            onClick={() => { setAssignModal({ candidateId: c.id, name: c.display_name || c.full_name }); setSelectedRecruiterId(""); }}
                            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-[#1C1B1A] hover:border-[#FE6E3E] hover:text-[#FE6E3E]"
                          >
                            Assign to Recruiter
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Urgent Unrouted Alerts */}
        {data.unroutedAlerts.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-red-700">Urgent — Needs Recruiter Assignment</h2>
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{data.unroutedAlerts.length}</span>
            </div>
            <div className="space-y-2">
              {data.unroutedAlerts.map((alert) => {
                const hoursAgo = Math.floor((Date.now() - new Date(alert.created_at).getTime()) / (1000 * 60 * 60));
                return (
                  <div key={alert.id} className="rounded-lg border-2 border-red-300 bg-red-50 p-3 flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-white text-xs font-bold">!</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#1C1B1A]">{alert.candidate_name}</p>
                      <p className="text-xs text-red-700 font-medium">{alert.role_category_custom || "Custom role"}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${alert.ai_interview_result ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        AI: {alert.ai_interview_result ? "Passed" : "Failed"}
                      </span>
                      <p className={`mt-1 text-[10px] font-medium ${hoursAgo > 24 ? "text-red-600" : "text-gray-500"}`}>{hoursAgo}h ago</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Recent Go-Lives */}
        {data.recentGoLives.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-[#1C1B1A] mb-3">Recent Go-Lives</h2>
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="divide-y divide-gray-100">
                {data.recentGoLives.map((c) => {
                  const isUnread = data.managerNotifications.some(
                    (n) => n.candidate_id === c.id && !n.read_at
                  );
                  const timeAgo = (() => {
                    const mins = Math.floor((Date.now() - new Date(c.profile_went_live_at).getTime()) / 60000);
                    if (mins < 60) return `${mins}m ago`;
                    const hours = Math.floor(mins / 60);
                    if (hours < 24) return `${hours}h ago`;
                    return `${Math.floor(hours / 24)}d ago`;
                  })();
                  return (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                      {isUnread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#FE6E3E]" />}
                      {!isUnread && <span className="h-2.5 w-2.5 shrink-0" />}
                      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-gray-100">
                        {c.profile_photo_url ? (
                          <img src={c.profile_photo_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-gray-400">{(c.display_name || c.full_name)?.[0]}</div>
                        )}
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
            </div>
          </section>
        )}

        {/* Pipeline Velocity & Metrics */}
        <section>
          <h2 className="text-sm font-semibold text-[#1C1B1A] mb-3">Pipeline Metrics</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{data.metrics.approvedThisWeek}</p>
              <p className="text-[10px] text-gray-400 uppercase font-medium mt-1">Approved This Week</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
              <p className="text-2xl font-bold text-[#FE6E3E]">{data.metrics.weeklyPostingCompliance}%</p>
              <p className="text-[10px] text-gray-400 uppercase font-medium mt-1">Posting Compliance</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 col-span-2">
              <p className="text-[10px] text-gray-400 uppercase font-medium mb-2">Top Revision Blockers</p>
              {data.metrics.topRevisionItems.length === 0 ? (
                <p className="text-xs text-gray-400">No revisions this week</p>
              ) : (
                <div className="space-y-1">
                  {data.metrics.topRevisionItems.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-gray-500 w-4">{i + 1}.</span>
                      <span className="text-xs text-[#1C1B1A] flex-1">{item.type}</span>
                      <span className="text-xs font-semibold text-gray-500">{item.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Posting Compliance Grid */}
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
                      return (
                        <th key={day} className={`px-3 py-2 text-center ${isToday ? "bg-orange-50" : ""}`}>
                          {d.toLocaleDateString("en-US", { weekday: "short" })}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {data.complianceGrid.map((row) => {
                    const todayIdx = data.gridDays.indexOf(new Date().toISOString().split("T")[0]);
                    const isNoon = new Date().getHours() >= 12;
                    const todayCount = todayIdx >= 0 ? row.days[todayIdx]?.count || 0 : 0;
                    const showWarning = isNoon && todayCount === 0;
                    return (
                      <tr key={row.recruiterId} className={`border-b border-gray-50 ${showWarning ? "bg-red-50" : ""}`}>
                        <td className="px-4 py-2 font-medium text-[#1C1B1A]">{row.recruiterName}</td>
                        {row.days.map((day, i) => {
                          const isToday = data.gridDays[i] === new Date().toISOString().split("T")[0];
                          return (
                            <td key={i} className={`px-3 py-2 text-center ${isToday ? "bg-orange-50" : ""}`}>
                              <span className={`font-semibold ${day.count >= 2 ? "text-green-600" : day.count === 1 ? "text-amber-500" : "text-gray-300"}`}>
                                {day.count}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Ban Request Queue */}
        {data.banQueue.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-[#1C1B1A]">Ban Requests</h2>
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{data.banQueue.length}</span>
            </div>
            <div className="space-y-3">
              {data.banQueue.map((c) => (
                <div key={c.id} className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-[#1C1B1A]">{c.display_name || c.full_name}</p>
                      <p className="text-[11px] text-gray-500">{c.role_category} &middot; Requested by {c.ban_requested_by_name}</p>
                      <p className="mt-2 text-sm text-red-800 bg-red-100 rounded-lg p-3">{c.ban_reason}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Stalled Revisions */}
        {data.stalledRevisions.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-[#1C1B1A]">Stalled Revisions (&gt;72h)</h2>
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">{data.stalledRevisions.length}</span>
            </div>
            <div className="space-y-3">
              {data.stalledRevisions.map((rev) => {
                const c = rev.candidates;
                const daysStalled = Math.floor((Date.now() - new Date(rev.created_at).getTime()) / (1000 * 60 * 60 * 24));
                return (
                  <div key={rev.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-100">
                        {c.profile_photo_url ? <img src={c.profile_photo_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-xs font-bold text-gray-400">{(c.display_name || c.full_name)?.[0]}</div>}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-[#1C1B1A]">{c.display_name || c.full_name}</p>
                        <p className="text-[11px] text-gray-500">{c.role_category} &middot; <span className="text-red-500 font-semibold">{daysStalled}d stalled</span></p>
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
        {/* Platform-wide Candidate Table */}
        <section>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-[#1C1B1A]">All Candidates</h2>
            {!candidatesLoaded && (
              <button
                onClick={() => loadAllCandidates(token)}
                className="rounded-lg bg-[#FE6E3E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#E55A2B]"
              >
                Load Candidates
              </button>
            )}
          </div>
          {candidatesLoaded && (
            <>
              {/* Filters */}
              <div className="flex flex-wrap gap-2 mb-3">
                <input
                  type="text"
                  value={candidatesSearch}
                  onChange={(e) => setCandidatesSearch(e.target.value)}
                  placeholder="Search name or email..."
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E] w-52"
                />
                <select
                  value={candidatesRecruiterFilter}
                  onChange={(e) => setCandidatesRecruiterFilter(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E]"
                >
                  <option value="">All recruiters</option>
                  <option value="__unassigned__">Unassigned</option>
                  {[...new Set(allCandidates.map((c) => c.recruiter_name).filter(Boolean))].sort().map((name) => (
                    <option key={name!} value={name!}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 text-gray-400 uppercase text-[10px] font-medium">
                        <th className="px-4 py-2.5 text-left">Candidate</th>
                        <th className="px-4 py-2.5 text-left">Role</th>
                        <th className="px-4 py-2.5 text-left">Status</th>
                        <th className="px-4 py-2.5 text-left">Recruiter</th>
                        <th className="px-4 py-2.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allCandidates
                        .filter((c) => {
                          const q = candidatesSearch.toLowerCase();
                          const matchSearch = !q || c.display_name.toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q);
                          const matchRecruiter = !candidatesRecruiterFilter
                            ? true
                            : candidatesRecruiterFilter === "__unassigned__"
                            ? !c.assigned_recruiter
                            : c.recruiter_name === candidatesRecruiterFilter;
                          return matchSearch && matchRecruiter;
                        })
                        .slice(0, 100)
                        .map((c) => (
                          <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-4 py-2.5 font-medium text-[#1C1B1A]">{c.display_name}</td>
                            <td className="px-4 py-2.5 text-gray-500">{c.role_category || "—"}</td>
                            <td className="px-4 py-2.5">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                c.admin_status === "approved" ? "bg-green-100 text-green-700" :
                                c.admin_status === "active" ? "bg-blue-100 text-blue-700" :
                                c.admin_status === "profile_review" ? "bg-amber-100 text-amber-700" :
                                "bg-gray-100 text-gray-600"
                              }`}>
                                {c.admin_status}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-gray-500">{c.recruiter_name || <span className="italic text-gray-300">Unassigned</span>}</td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                onClick={() => setReassignModal({
                                  candidateId: c.id,
                                  candidateName: c.display_name,
                                  currentRecruiterId: c.assigned_recruiter || null,
                                })}
                                className="rounded-lg border border-gray-200 px-2.5 py-1 text-[10px] font-medium text-[#1C1B1A] hover:border-[#FE6E3E] hover:text-[#FE6E3E] transition-colors"
                              >
                                Reassign
                              </button>
                            </td>
                          </tr>
                        ))}
                      {allCandidates.filter((c) => {
                        const q = candidatesSearch.toLowerCase();
                        const matchSearch = !q || c.display_name.toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q);
                        const matchRecruiter = !candidatesRecruiterFilter
                          ? true
                          : candidatesRecruiterFilter === "__unassigned__"
                          ? !c.assigned_recruiter
                          : c.recruiter_name === candidatesRecruiterFilter;
                        return matchSearch && matchRecruiter;
                      }).length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-xs">No candidates match your filters.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Recruiter Photo Approval Queue */}
        {token && currentUserId && (
          <section>
            <h2 className="text-sm font-semibold text-[#1C1B1A] mb-3">Recruiter Photos — Pending Approval</h2>
            <RecruiterPhotoQueue
              token={token}
              currentUserId={currentUserId}
              currentUserRole="recruiting_manager"
            />
          </section>
        )}
      </div>
    </>
  );

  // Mine tab content (personal recruiter view)
  const mineView = personalData ? (
    <div className="px-4 py-4 space-y-4">
      <KpiStrip kpi={data.personalKpi} token={token} onCalendarSaved={handleCalendarSave} onPostLogged={loadDashboard} />
      <div className="space-y-6">
        <div>
          <h2 className="text-sm font-semibold text-[#1C1B1A] mb-3">Resumes to Review</h2>
          <Lane1Resumes candidates={personalData.lane1 || []} calendarLink={data.personalKpi.calendarLink} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[#1C1B1A] mb-3">Profiles to Submit</h2>
          <Lane2Profiles candidates={personalData.lane2 || []} token={token} onSubmitForApproval={() => loadDashboard()} onRequestRevision={(id, name) => setRevisionModal({ candidateId: id, name })} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[#1C1B1A] mb-3">Revision Follow-ups</h2>
          <Lane3Revisions revisions={personalData.lane3 || []} token={token} onReminderSent={loadDashboard} />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Desktop: full team view */}
      <div className="hidden md:block">{teamView}</div>

      {/* Mobile: Mine / Team tabs */}
      <div className="md:hidden">
        <div className="pb-16">
          {mobileTab === "team" ? teamView : mineView}
        </div>
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white flex">
          {(["mine", "team"] as MobileTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setMobileTab(tab)}
              className={`flex-1 py-3 text-xs font-semibold text-center transition-colors ${mobileTab === tab ? "text-[#FE6E3E] border-t-2 border-[#FE6E3E]" : "text-gray-400"}`}
            >
              {tab === "mine" ? "Mine" : "Team"}
            </button>
          ))}
        </div>
      </div>

      {/* Assign modal */}
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
                onClick={() => handleAssign(assignModal.candidateId, selectedRecruiterId, false)}
                disabled={assigning || !selectedRecruiterId}
                className="flex-1 rounded-lg bg-[#FE6E3E] py-2.5 text-sm font-semibold text-white hover:bg-[#E55A2B] disabled:opacity-50"
              >
                {assigning ? "Assigning..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revision modal */}
      {revisionModal && (
        <RevisionModal
          candidateName={revisionModal.name}
          candidateId={revisionModal.candidateId}
          token={token}
          onClose={() => setRevisionModal(null)}
          onSubmitted={() => { setRevisionModal(null); loadDashboard(); }}
        />
      )}

      {/* Reassign modal */}
      {reassignModal && (
        <ReassignModal
          candidateId={reassignModal.candidateId}
          candidateName={reassignModal.candidateName}
          currentRecruiterId={reassignModal.currentRecruiterId}
          currentRecruiterName={null}
          token={token}
          onClose={() => setReassignModal(null)}
          onSuccess={() => {
            setReassignModal(null);
            loadDashboard();
            if (candidatesLoaded) loadAllCandidates(token);
          }}
        />
      )}
    </div>
  );
}
