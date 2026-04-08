"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import KpiStrip from "@/components/recruiter/KpiStrip";
import Lane1Resumes from "@/components/recruiter/Lane1Resumes";
import Lane2Profiles from "@/components/recruiter/Lane2Profiles";
import Lane3Revisions from "@/components/recruiter/Lane3Revisions";
import RevisionModal from "@/components/recruiter/RevisionModal";
import MessageSidebar from "@/components/recruiter/MessageSidebar";
import InternalChat from "@/components/recruiter/InternalChat";
import ManagerDashboard from "@/components/recruiter/ManagerDashboard";

interface DashboardData {
  kpi: {
    interviewsToday: number;
    dailyTarget: number;
    recruiterType: string;
    socialPosts: { id: string; post_url: string; created_at: string }[];
    calendarLink: string | null;
    calendarValid: boolean | null;
  };
  queue: {
    id: string;
    display_name: string;
    full_name: string;
    role_category: string;
    profile_photo_url: string | null;
    ai_interview_completed_at: string;
    email: string;
  }[];
  allAssigned: {
    id: string;
    display_name: string | null;
    full_name: string;
    profile_photo_url: string | null;
  }[];
  lane1: {
    id: string;
    display_name: string;
    full_name: string;
    role_category: string;
    profile_photo_url: string | null;
    second_interview_scheduled_at: string;
    screening_score: number | null;
    resume_url: string | null;
    recruiter_ai_score_results: { dimension: string; score: number }[] | null;
  }[];
  lane2: {
    id: string;
    display_name: string;
    full_name: string;
    role_category: string;
    profile_photo_url: string | null;
    screening_score: number | null;
    second_interview_completed_at: string | null;
    admin_status: string;
    tagline: string | null;
    bio: string | null;
    resume_url: string | null;
    payout_method: string | null;
    id_verification_status: string | null;
    voice_recording_1_url: string | null;
    voice_recording_2_url: string | null;
    english_mc_score: number | null;
    english_comprehension_score: number | null;
    speaking_level: string | null;
    interview_consent_at: string | null;
    recruiter_ai_score_results: { dimension: string; score: number }[] | null;
    video_intro_url?: string | null;
    id_verification_consent: boolean | null;
  }[];
  lane3: {
    id: string;
    candidate_id: string;
    items: { type: string; note?: string }[];
    status: string;
    created_at: string;
    candidates: {
      id: string;
      display_name: string;
      full_name: string;
      role_category: string;
      profile_photo_url: string | null;
    };
  }[];
  threads: {
    candidate_id: string;
    last_message: string;
    last_message_at: string;
    unread_count: number;
  }[];
  profile: { role: string; calendarLink: string | null };
}

type MobileTab = "resumes" | "profiles" | "revisions" | "messages" | "team";
type SidebarTab = "messages" | "team";

export default function RecruiterDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [mobileTab, setMobileTab] = useState<MobileTab>("resumes");
  const [revisionModal, setRevisionModal] = useState<{ candidateId: string; name: string } | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("messages");

  // 10-second timeout fallback — never leave the spinner hanging
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

    // Detect role
    const role = session.user.user_metadata?.role;
    setUserRole(role);

    // If recruiting_manager, the ManagerDashboard component handles its own data loading
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

  // Build candidate map for message sidebar — from ALL assigned candidates so threads always show a name
  const candidateMap = new Map<string, { name: string; photo: string | null }>();
  if (data) {
    for (const c of data.allAssigned) {
      candidateMap.set(c.id, { name: c.display_name || c.full_name, photo: c.profile_photo_url });
    }
    // Lane candidates override with more complete data if present
    for (const c of [...data.lane1, ...data.lane2]) {
      candidateMap.set(c.id, { name: c.display_name || c.full_name, photo: c.profile_photo_url });
    }
    for (const rev of data.lane3) {
      const c = rev.candidates;
      candidateMap.set(c.id, { name: c.display_name || c.full_name, photo: c.profile_photo_url });
    }
  }

  async function handleCalendarSave(link: string) {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase
      .from("profiles")
      .update({ calendar_link: link || null })
      .eq("id", session.user.id);
    loadDashboard();
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" /></div>;
  }

  // Auth error — stop everything, no retries
  if (authError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-gray-500">Session error. Please sign out and sign back in.</p>
      </div>
    );
  }

  // Recruiting manager gets their own dashboard
  if (userRole === "recruiting_manager") {
    return <ManagerDashboard />;
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

  const totalUnread = data.threads.reduce((s, t) => s + t.unread_count, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* KPI Strip — fixed at top */}
      <KpiStrip
        kpi={data.kpi}
        token={token}
        onCalendarSaved={handleCalendarSave}
        onPostLogged={loadDashboard}
      />

      {/* Queue — candidates ready to schedule (AI done, second interview not yet scheduled) */}
      {data.queue.length > 0 && (
        <div className="mx-auto max-w-[1600px] px-4 pt-4">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-blue-900">New Candidates — Schedule Second Interview</h2>
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-blue-200 px-1.5 text-[10px] font-bold text-blue-800">{data.queue.length}</span>
            </div>
            <div className="flex flex-wrap gap-3">
              {data.queue.map((c) => (
                <div key={c.id} className="flex items-center gap-2.5 rounded-lg border border-blue-200 bg-white px-3 py-2.5 shadow-sm">
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-400">
                    {(c.display_name || c.full_name)?.charAt(0) || "?"}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#1C1B1A]">{c.display_name || c.full_name}</p>
                    <p className="text-[10px] text-gray-500">{c.role_category}</p>
                  </div>
                  {data.kpi.calendarLink && (
                    <a
                      href={data.kpi.calendarLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 rounded-full bg-[#FE6E3E] px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-[#E55A2B] transition-colors"
                    >
                      Schedule
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Desktop: three lanes + message sidebar */}
      <div className="hidden md:flex mx-auto max-w-[1600px]">
        {/* Three lanes */}
        <div className="flex-1 grid grid-cols-3 gap-4 p-4">
          {/* Lane 1 — Resumes */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-[#1C1B1A]">Resumes to Review</h2>
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-gray-200 px-1.5 text-[10px] font-bold text-gray-600">{data.lane1.length}</span>
            </div>
            <Lane1Resumes candidates={data.lane1} calendarLink={data.kpi.calendarLink} />
          </div>

          {/* Lane 2 — Profiles */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-[#1C1B1A]">Profiles to Submit</h2>
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-gray-200 px-1.5 text-[10px] font-bold text-gray-600">{data.lane2.length}</span>
            </div>
            <Lane2Profiles
              candidates={data.lane2}
              token={token}
              onSubmitForApproval={() => loadDashboard()}
              onRequestRevision={(id, name) => setRevisionModal({ candidateId: id, name })}
            />
          </div>

          {/* Lane 3 — Revisions */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-[#1C1B1A]">Revision Follow-ups</h2>
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-700">{data.lane3.length}</span>
            </div>
            <Lane3Revisions revisions={data.lane3} token={token} onReminderSent={loadDashboard} />
          </div>
        </div>

        {/* Right sidebar — tabbed: Candidate Messages | Team */}
        <div className="w-[280px] shrink-0 sticky top-[76px] h-[calc(100vh-76px)] flex flex-col">
          {/* Tab switcher */}
          <div className="flex border-b border-gray-200 bg-white">
            <button
              onClick={() => setSidebarTab("messages")}
              className={`flex-1 py-2.5 text-[11px] font-semibold transition-colors ${sidebarTab === "messages" ? "text-[#FE6E3E] border-b-2 border-[#FE6E3E]" : "text-gray-400 hover:text-gray-600"}`}
            >
              Messages
            </button>
            <button
              onClick={() => setSidebarTab("team")}
              className={`flex-1 py-2.5 text-[11px] font-semibold transition-colors ${sidebarTab === "team" ? "text-[#FE6E3E] border-b-2 border-[#FE6E3E]" : "text-gray-400 hover:text-gray-600"}`}
            >
              Team
            </button>
          </div>
          {sidebarTab === "messages" ? (
            <MessageSidebar threads={data.threads} candidateMap={candidateMap} token={token} />
          ) : (
            <InternalChat />
          )}
        </div>
      </div>

      {/* Mobile: single view with bottom tab bar */}
      <div className="md:hidden">
        <div className="px-4 py-4 pb-24">
          {/* Queue always shown at top on mobile */}
          {data.queue.length > 0 && (
            <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3">
              <p className="text-xs font-semibold text-blue-900 mb-2">New Candidates ({data.queue.length})</p>
              <div className="space-y-2">
                {data.queue.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-white border border-blue-100 px-3 py-2">
                    <div>
                      <p className="text-xs font-semibold text-[#1C1B1A]">{c.display_name || c.full_name}</p>
                      <p className="text-[10px] text-gray-500">{c.role_category}</p>
                    </div>
                    {data.kpi.calendarLink && (
                      <a href={data.kpi.calendarLink} target="_blank" rel="noopener noreferrer"
                        className="rounded-full bg-[#FE6E3E] px-2.5 py-1 text-[10px] font-semibold text-white">
                        Schedule
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {mobileTab === "resumes" && (
            <>
              <h2 className="text-sm font-semibold text-[#1C1B1A] mb-3">Resumes to Review</h2>
              <Lane1Resumes candidates={data.lane1} calendarLink={data.kpi.calendarLink} />
            </>
          )}
          {mobileTab === "profiles" && (
            <>
              <h2 className="text-sm font-semibold text-[#1C1B1A] mb-3">Profiles to Submit</h2>
              <Lane2Profiles
                candidates={data.lane2}
                token={token}
                onSubmitForApproval={() => loadDashboard()}
                onRequestRevision={(id, name) => setRevisionModal({ candidateId: id, name })}
              />
            </>
          )}
          {mobileTab === "revisions" && (
            <>
              <h2 className="text-sm font-semibold text-[#1C1B1A] mb-3">Revision Follow-ups</h2>
              <Lane3Revisions revisions={data.lane3} token={token} onReminderSent={loadDashboard} />
            </>
          )}
          {mobileTab === "messages" && (
            <div className="h-[calc(100vh-200px)]">
              <MessageSidebar threads={data.threads} candidateMap={candidateMap} token={token} isMobileFullScreen />
            </div>
          )}
          {mobileTab === "team" && (
            <div className="h-[calc(100vh-200px)]">
              <InternalChat isMobileFullScreen />
            </div>
          )}
        </div>

        {/* Bottom tab bar */}
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white flex">
          {([
            { key: "resumes" as MobileTab, label: "Resumes", count: data.lane1.length },
            { key: "profiles" as MobileTab, label: "Profiles", count: data.lane2.length },
            { key: "revisions" as MobileTab, label: "Revisions", count: data.lane3.length },
            { key: "messages" as MobileTab, label: "Messages", count: totalUnread },
            { key: "team" as MobileTab, label: "Team", count: 0 },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setMobileTab(tab.key)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
                mobileTab === tab.key ? "text-[#FE6E3E]" : "text-gray-400"
              }`}
            >
              <span className="relative">
                {tab.label}
                {tab.count > 0 && (
                  <span className={`absolute -top-2 -right-4 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[8px] font-bold text-white ${
                    tab.key === "messages" ? "bg-[#FE6E3E]" : "bg-gray-400"
                  }`}>
                    {tab.count}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

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
    </div>
  );
}
