"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import KpiStrip from "@/components/recruiter/KpiStrip";
import MessageSidebar from "@/components/recruiter/MessageSidebar";
import InternalChat from "@/components/recruiter/InternalChat";
import ManagerDashboard from "@/components/recruiter/ManagerDashboard";
import RecruiterNotificationBell from "@/components/recruiter/RecruiterNotificationBell";

interface CandidateBase {
  id: string;
  display_name: string | null;
  full_name?: string | null;
  role_category?: string | null;
  profile_photo_url: string | null;
}

interface PipelineRow extends CandidateBase {
  admin_status: string | null;
  second_interview_status: string | null;
  created_at: string | null;
  ai_interview_completed_at: string | null;
  ai_interview_score?: number | null;
}

interface DashboardData {
  kpi: {
    interviewsToday: number;
    dailyTarget: number;
    recruiterType: string;
    socialPosts: { id: string; post_url: string; created_at: string }[];
    calendarLink: string | null;
    calendarValid: boolean | null;
  };
  queue: (CandidateBase & { ai_interview_completed_at: string; email: string })[];
  allAssigned: CandidateBase[];
  lane1: (CandidateBase & { second_interview_scheduled_at: string })[];
  lane2: (CandidateBase & { second_interview_completed_at: string | null })[];
  lane3: {
    id: string;
    candidate_id: string;
    items: { type: string; note?: string }[];
    status: string;
    created_at: string;
    candidates: CandidateBase;
  }[];
  pipeline: PipelineRow[];
  threads: {
    candidate_id: string;
    last_message: string;
    last_message_at: string;
    unread_count: number;
  }[];
  profile: { role: string; calendarLink: string | null };
}

type SidebarTab = "messages" | "team";

function getPipelineStatus(row: PipelineRow): { label: string; className: string } {
  if (row.admin_status === "approved") {
    return { label: "Live", className: "bg-green-100 text-green-800" };
  }
  if (row.admin_status === "revision_required") {
    return { label: "Needs Revision", className: "bg-orange-100 text-orange-800" };
  }
  if (row.admin_status === "pending_speaking_review" && row.second_interview_status === "completed") {
    return { label: "Ready to Submit", className: "bg-blue-100 text-blue-800" };
  }
  if (row.second_interview_status === "scheduled") {
    return { label: "Interview Scheduled", className: "bg-purple-100 text-purple-800" };
  }
  if (row.second_interview_status === "none" && row.ai_interview_completed_at) {
    return { label: "Ready to Schedule", className: "bg-orange-100 text-orange-800" };
  }
  return { label: "In Progress", className: "bg-gray-100 text-gray-700" };
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Avatar({ src, name, size = 36 }: { src: string | null | undefined; name: string | null | undefined; size?: number }) {
  const initial = (name || "?").charAt(0).toUpperCase();
  return (
    <div
      className="shrink-0 overflow-hidden rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-400"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initial}
    </div>
  );
}

interface ActionCardCandidate {
  id: string;
  display_name: string | null;
  profile_photo_url: string | null;
}

function ActionLaneCard({ title, candidates }: { title: string; candidates: ActionCardCandidate[] }) {
  const count = candidates.length;
  const shown = candidates.slice(0, 4);
  const overflow = count - shown.length;
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[#1C1B1A]">{title}</h3>
        <span className="flex h-6 min-w-[24px] items-center justify-center rounded-full bg-[#FE6E3E] px-1.5 text-[11px] font-bold text-white">
          {count}
        </span>
      </div>
      {count === 0 ? (
        <p className="text-xs text-gray-400">All clear</p>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((c) => (
            <a
              key={c.id}
              href={`/admin/candidates/${c.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 rounded-lg border border-gray-100 bg-[#FAFAFA] px-2 py-1.5 hover:border-[#FE6E3E] hover:bg-orange-50 transition-colors"
            >
              <Avatar src={c.profile_photo_url} name={c.display_name} size={24} />
              <span className="flex-1 text-xs font-medium text-[#1C1B1A] truncate">
                {c.display_name || "Unnamed"}
              </span>
              <span className="flex items-center gap-0.5 text-[10px] font-semibold text-gray-400 group-hover:text-[#FE6E3E]">
                View
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17L17 7" />
                  <path d="M8 7h9v9" />
                </svg>
              </span>
            </a>
          ))}
          {overflow > 0 && (
            <p className="text-[11px] font-medium text-gray-500 px-1">+{overflow} more</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function RecruiterDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("messages");
  const [pendingMessageCandidateId, setPendingMessageCandidateId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      setLoading(false);
      setLoadError(true);
    }, 10000);
    return () => clearTimeout(timer);
  }, [loading]);

  const loadDashboard = useCallback(async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push("/login"); return; }
    setToken(session.access_token);

    const role = session.user.user_metadata?.role;
    setUserRole(role);

    if (role === "recruiting_manager") {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/recruiter/dashboard", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 401 || res.status === 403) {
        setLoading(false);
        setAuthError(true);
        return;
      }
      if (!res.ok) { setLoading(false); return; }
      const result = await res.json();
      setData(result);
    } catch { /* silent */ }
    setLoading(false);
  }, [router]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const candidateMap = new Map<string, { name: string; photo: string | null }>();
  if (data) {
    for (const c of data.allAssigned) {
      candidateMap.set(c.id, { name: c.display_name || c.full_name || "Unnamed", photo: c.profile_photo_url });
    }
    for (const c of data.pipeline) {
      candidateMap.set(c.id, { name: c.display_name || "Unnamed", photo: c.profile_photo_url });
    }
    for (const rev of data.lane3) {
      const c = rev.candidates;
      candidateMap.set(c.id, { name: c.display_name || c.full_name || "Unnamed", photo: c.profile_photo_url });
    }
  }

  async function handleCalendarSave(link: string) {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch("/api/recruiter/calendar-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ calendar_link: link || null }),
    });
    loadDashboard();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" />
      </div>
    );
  }

  if (authError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-gray-500">Session error. Please sign out and sign back in.</p>
      </div>
    );
  }

  if (userRole === "recruiting_manager") {
    return <ManagerDashboard />;
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-gray-500">{loadError ? "Unable to load dashboard. Please refresh." : "Failed to load dashboard"}</p>
        <button
          onClick={() => { setLoadError(false); setLoading(true); loadDashboard(); }}
          className="rounded-lg bg-[#FE6E3E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#E55A2B]"
        >
          Retry
        </button>
      </div>
    );
  }

  const pipeline = data.pipeline || [];
  const pipelineCount = pipeline.length;

  const lane3Chips: ActionCardCandidate[] = data.lane3.map((rev) => ({
    id: rev.candidate_id,
    display_name: rev.candidates.display_name || rev.candidates.full_name || null,
    profile_photo_url: rev.candidates.profile_photo_url,
  }));

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="relative">
        <KpiStrip
          kpi={data.kpi}
          token={token}
          pipelineCount={pipelineCount}
          onCalendarSaved={handleCalendarSave}
          onPostLogged={loadDashboard}
        />
        {token && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <RecruiterNotificationBell token={token} />
          </div>
        )}
      </div>

      <div className="mx-auto max-w-[1600px] px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left column — 75% (Zone 1 + Zone 2) */}
          <div className="lg:col-span-3 space-y-6">
            {/* Zone 1 — My Pipeline */}
            <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                <h2 className="text-base font-semibold text-[#1C1B1A]">My Pipeline</h2>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                  {pipelineCount} {pipelineCount === 1 ? "candidate" : "candidates"}
                </span>
              </div>
              {pipelineCount === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm text-gray-500">No candidates assigned yet.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-[#FAFAFA] text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-5 py-3 text-left w-14"></th>
                        <th className="px-5 py-3 text-left">Name</th>
                        <th className="px-5 py-3 text-left">Status</th>
                        <th className="px-5 py-3 text-left">AI Score</th>
                        <th className="px-5 py-3 text-left">Assigned</th>
                        <th className="px-5 py-3 text-left w-1"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pipeline.map((row) => {
                        const status = getPipelineStatus(row);
                        const score = row.ai_interview_score;
                        return (
                          <tr
                            key={row.id}
                            onClick={() => window.open(`/admin/candidates/${row.id}`, "_blank", "noopener,noreferrer")}
                            className="hover:bg-gray-50 cursor-pointer"
                          >
                            <td className="px-5 py-3">
                              <Avatar src={row.profile_photo_url} name={row.display_name} size={36} />
                            </td>
                            <td className="px-5 py-3">
                              <p className="font-semibold text-[#1C1B1A]">
                                {row.display_name || "Unnamed"}
                              </p>
                              <p className="text-xs text-gray-500">{row.role_category || "—"}</p>
                            </td>
                            <td className="px-5 py-3">
                              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${status.className}`}>
                                {status.label}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-[#1C1B1A]">
                              {typeof score === "number" ? `${score}/100` : "—"}
                            </td>
                            <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">
                              {formatShortDate(row.created_at)}
                            </td>
                            <td className="px-5 py-3 text-right">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSidebarTab("messages");
                                  setPendingMessageCandidateId(row.id);
                                  if (typeof window !== "undefined" && window.innerWidth < 1024) {
                                    document.getElementById("recruiter-sidebar")?.scrollIntoView({ behavior: "smooth", block: "start" });
                                  }
                                }}
                                className="inline-flex items-center gap-1 rounded-md bg-[#FE6E3E] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#E55A2B] transition-colors"
                              >
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                                </svg>
                                Message
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Zone 2 — Action Lanes */}
            <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <ActionLaneCard
                title="Ready to Schedule"
                candidates={data.queue.map((c) => ({
                  id: c.id,
                  display_name: c.display_name || c.full_name || null,
                  profile_photo_url: c.profile_photo_url,
                }))}
              />
              <ActionLaneCard
                title="Interview Scheduled"
                candidates={data.lane1.map((c) => ({
                  id: c.id,
                  display_name: c.display_name || c.full_name || null,
                  profile_photo_url: c.profile_photo_url,
                }))}
              />
              <ActionLaneCard
                title="Ready to Submit"
                candidates={data.lane2.map((c) => ({
                  id: c.id,
                  display_name: c.display_name || c.full_name || null,
                  profile_photo_url: c.profile_photo_url,
                }))}
              />
              <ActionLaneCard title="Needs Revision" candidates={lane3Chips} />
            </section>
          </div>

          {/* Right column — 25% (Zone 3 sidebar) */}
          <aside id="recruiter-sidebar" className="lg:col-span-1">
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col lg:sticky lg:top-[76px] lg:h-[calc(100vh-100px)]">
              <div className="flex border-b border-gray-200">
                <button
                  onClick={() => setSidebarTab("messages")}
                  className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                    sidebarTab === "messages"
                      ? "text-[#FE6E3E] border-b-2 border-[#FE6E3E]"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  Messages
                </button>
                <button
                  onClick={() => setSidebarTab("team")}
                  className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                    sidebarTab === "team"
                      ? "text-[#FE6E3E] border-b-2 border-[#FE6E3E]"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  Team
                </button>
              </div>
              <div className="flex-1 min-h-[400px] flex flex-col">
                {sidebarTab === "messages" ? (
                  <MessageSidebar
                    threads={data.threads}
                    candidateMap={candidateMap}
                    token={token}
                    defaultOpenCandidateId={pendingMessageCandidateId}
                    onThreadOpened={() => setPendingMessageCandidateId(null)}
                  />
                ) : (
                  <InternalChat />
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
