"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/admin/Toast";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface Pipeline {
  applied: number;
  englishPass: number;
  idVerified: number;
  profileBuilt: number;
  aiInterview: number;
  pending2ndInterview: number;
  live: number;
}

interface PendingCandidate {
  id: string;
  full_name: string;
  display_name: string;
  role_category: string;
  country: string;
  monthly_rate: number;
  english_tier: string;
  english_mc_score: number;
  english_comprehension_score: number;
  ai_interview_score: number;
  years_experience: number;
  voice_recording_1_url: string | null;
  voice_recording_2_url: string | null;
  id_verification_status: string;
  profile_photo_url: string | null;
}

interface WarmLead {
  id: string;
  name: string;
  activity: string;
  daysCold: number;
  isNew: boolean;
}

interface ClientRow {
  id: string;
  name: string;
  email: string;
  lastLogin: string;
  daysSinceLogin: number;
  browseActivity: string;
  activeEngagements: number;
  totalFees: number;
  joined: string;
  status: string;
}

interface RouteCandidate {
  id: string;
  full_name: string;
  display_name: string;
  role_category: string;
  country: string;
  monthly_rate: number;
  created_at: string;
}

interface DashboardData {
  mrr: number;
  mrrSparkline: number[];
  liveCandidates: number;
  activeEngagements: number;
  newEngThisWeek: number;
  platformFeeThisMonth: number;
  warmLeadsCount: number;
  seminarDate: string;
  pipeline: Pipeline;
  pendingCandidates: PendingCandidate[];
  warmLeads: WarmLead[];
  recruiterAlerts: {
    missingCalendar: { id: string; name: string }[];
    needsRouting: number;
    unreviewedByRecruiter: { id: string; name: string; count: number }[];
  };
  screening: { pending: number; processing: number; complete: number; failed: number; screenedToday: number };
  identity: { lockouts: number; dupesWeek: number; flagged: number; verified: number };
  pulse: {
    applicationsThisWeek: number;
    applicationsLastWeek: number;
    appChangePercent: number;
    clientsThisWeek: number;
    clientsLastWeek: number;
    clientWeekChange: number;
    activeConversations: number;
    newCandidatesMonth: number;
  };
  clientHealth: ClientRow[];
  clientsThisMonth: number;
  totalClients: number;
  talentPoolHealth: { liveCandidates: number; rolesBelow2: number };
  badges: Record<string, number>;
  routeCandidates: RouteCandidate[];
  recruiters: { id: string; name: string }[];
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? "s" : ""} ago`;
  return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? "s" : ""} ago`;
}

const MONO = "'DM Mono', monospace";

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function AdminDashboard() {
  const router = useRouter();
  const { showToast } = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [modal, setModal] = useState<string | null>(null);
  const [routeAssignments, setRouteAssignments] = useState<Record<string, string>>({});
  const [approveSearch, setApproveSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/command-center");
      if (res.status === 403) { router.replace("/recruiter"); return; }
      const d = await res.json();
      setData(d);
    } catch { /* silent */ }
    setLoading(false);
  }, [router]);

  useEffect(() => { loadData(); }, [loadData]);

  // Listen for topbar button events
  useEffect(() => {
    function handleModal(e: Event) {
      const name = (e as CustomEvent).detail;
      if (name) setModal(name);
    }
    window.addEventListener("adc-open-modal", handleModal);
    return () => window.removeEventListener("adc-open-modal", handleModal);
  }, []);

  // ═══ AUDIO PLAYBACK ═══
  function playAudio(url: string | null, label: string) {
    if (!url) { showToast("No recording available"); return; }
    if (playingAudio === url) { setPlayingAudio(null); return; }
    setPlayingAudio(url);
    const audio = new Audio(url);
    audio.play().catch(() => showToast("Failed to play audio"));
    audio.onended = () => setPlayingAudio(null);
    showToast(`▶ Playing ${label}...`);
  }

  // ═══ APPROVE CANDIDATE ═══
  async function handleApprove(candidateId: string) {
    setActionLoading(candidateId);
    try {
      const res = await fetch("/api/admin/candidates/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, action: "approve" }),
      });
      if (res.ok) {
        showToast("✓ Candidate approved and live");
        await loadData();
      } else {
        const err = await res.json();
        showToast(`Error: ${err.error || "Failed"}`);
      }
    } catch { showToast("Network error"); }
    setActionLoading(null);
  }

  // ═══ APPROVE ALL PENDING ═══
  async function handleApproveAll() {
    if (!data) return;
    for (const c of data.pendingCandidates) {
      await handleApprove(c.id);
    }
  }

  // ═══ SEND REVISION ═══
  async function handleRevision(candidateId: string) {
    const note = prompt("Enter revision feedback:");
    if (!note) return;
    setActionLoading(candidateId);
    try {
      const res = await fetch("/api/admin/candidates/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, action: "revision_required", revisionNote: note }),
      });
      if (res.ok) {
        showToast("✓ Revision request sent");
        await loadData();
      }
    } catch { showToast("Network error"); }
    setActionLoading(null);
  }

  // ═══ ROUTE CANDIDATES ═══
  async function handleSaveRoutes() {
    if (!data) return;
    const unassigned = data.routeCandidates.filter((c) => !routeAssignments[c.id]);
    if (unassigned.length > 0) { showToast("⚠ Assign a specialist to all candidates"); return; }

    for (const c of data.routeCandidates) {
      const recruiterId = routeAssignments[c.id];
      try {
        await fetch("/api/admin/candidates", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId: c.id, assigned_recruiter: recruiterId, assignment_pending_review: false }),
        });
      } catch { /* continue */ }
    }
    showToast("✓ Candidates routed successfully");
    setModal(null);
    await loadData();
  }

  // ═══ EXPORT CSV ═══
  function exportCSV(type: string) {
    if (!data) return;
    let csv = "";
    let filename = "";

    if (type === "pipeline") {
      csv = "Stage,Count,Percentage\n";
      const stages = [
        ["Applied", data.pipeline.applied],
        ["English Pass", data.pipeline.englishPass],
        ["ID Verified", data.pipeline.idVerified],
        ["Profile Built", data.pipeline.profileBuilt],
        ["AI Interview", data.pipeline.aiInterview],
        ["Pending 2nd Interview", data.pipeline.pending2ndInterview],
        ["Live", data.pipeline.live],
      ] as [string, number][];
      for (const [label, count] of stages) {
        csv += `${label},${count},${data.pipeline.applied > 0 ? ((count / data.pipeline.applied) * 100).toFixed(1) : 0}%\n`;
      }
      filename = "candidate_pipeline.csv";
    } else if (type === "clients") {
      csv = "Client,Last Login,Browse Activity,Engagements,Total Fees,Joined,Status\n";
      for (const c of data.clientHealth) {
        csv += `"${c.name}",${relativeTime(c.lastLogin)},"${c.browseActivity}",${c.activeEngagements},$${c.totalFees},"${new Date(c.joined).toLocaleDateString("en-US", { month: "short", year: "numeric" })}",${c.status}\n`;
      }
      filename = "client_health.csv";
    } else {
      csv = "Recruiter,Unreviewed\n";
      for (const r of data.recruiterAlerts.unreviewedByRecruiter) {
        csv += `"${r.name}",${r.count}\n`;
      }
      filename = "recruiter_performance.csv";
    }

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`✓ ${filename} exported`);
    setModal(null);
  }

  // ═══ LOADING STATE ═══
  if (loading || !data) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "50vh" }}>
        <p style={{ color: "#9C9A94" }}>Loading command center...</p>
      </div>
    );
  }

  // ═══ COMPUTED VALUES ═══
  const seminarDate = new Date(data.seminarDate);
  const daysUntilSeminar = Math.max(0, Math.ceil((seminarDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  const candidatesNeeded = Math.max(0, 100 - data.liveCandidates);
  const showAlert = data.liveCandidates < 100;

  // Pipeline percentages
  const pStages = [
    { label: "Applied", count: data.pipeline.applied, color: "#E8E6E1" },
    { label: "English Pass", count: data.pipeline.englishPass, color: "#D4E4F8" },
    { label: "ID Verified", count: data.pipeline.idVerified, color: "#B5D4F4" },
    { label: "Profile Built", count: data.pipeline.profileBuilt, color: "#85B7EB" },
    { label: "AI Interview", count: data.pipeline.aiInterview, color: "#FDD4B8" },
    { label: "Pending 2nd Interview", count: data.pipeline.pending2ndInterview, color: "#FE9E6E" },
    { label: "Live ✓", count: data.pipeline.live, color: "#FE6E3E" },
  ];
  const totalApplied = data.pipeline.applied || 1;
  const conversionPct = ((data.pipeline.live / totalApplied) * 100).toFixed(1);

  // Biggest drop-off
  let biggestDrop = { from: "", to: "", fromPct: 0, toPct: 0, stuck: 0 };
  for (let i = 0; i < pStages.length - 1; i++) {
    const drop = pStages[i].count - pStages[i + 1].count;
    if (drop > biggestDrop.stuck) {
      biggestDrop = {
        from: pStages[i].label,
        to: pStages[i + 1].label,
        fromPct: Math.round((pStages[i].count / totalApplied) * 100),
        toPct: Math.round((pStages[i + 1].count / totalApplied) * 100),
        stuck: drop,
      };
    }
  }

  // MRR sparkline SVG
  const sparkW = 160;
  const sparkH = 28;
  const sparkData = data.mrrSparkline.length > 1 ? data.mrrSparkline : [0, 0];
  const sparkMax = Math.max(...sparkData, 1);
  const sparkMin = Math.min(...sparkData);
  const sparkRange = sparkMax - sparkMin || 1;
  const sparkPoints = sparkData.map((v, i) => {
    const x = (i / (sparkData.length - 1)) * sparkW;
    const y = sparkH - ((v - sparkMin) / sparkRange) * (sparkH - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  const lastSparkX = (sparkData.length - 1) / (sparkData.length - 1) * sparkW;
  const lastSparkY = sparkH - ((sparkData[sparkData.length - 1] - sparkMin) / sparkRange) * (sparkH - 4) - 2;

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "#1C1B1A" }}>

      {/* ═══ ALERT BANNER ═══ */}
      {showAlert && (
        <div style={{ background: "#FFF8F0", border: "1px solid #FDD4B8", borderLeft: "3px solid #FE6E3E", borderRadius: 8, padding: "9px 14px", display: "flex", alignItems: "center", gap: 10, marginBottom: 18, fontSize: 12.5, color: "#8B4A1A" }}>
          <span>🔴</span>
          <span><strong style={{ color: "#1C1B1A" }}>Seminar in {daysUntilSeminar} days.</strong> You need {candidatesNeeded} more approved profiles. Currently at {data.liveCandidates} of 100 target.</span>
          <span
            onClick={() => setModal("pipeline")}
            style={{ marginLeft: "auto", fontSize: 12, fontWeight: 500, color: "#FE6E3E", cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 5 }}
          >
            View Pipeline →
          </span>
        </div>
      )}

      {/* ═══ SCORE BAND ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr", gap: 12, marginBottom: 18 }}>
        {/* MRR Card (hero) */}
        <div style={{ background: "#1C1B1A", border: "1px solid #1C1B1A", borderRadius: 10, padding: "16px 18px", overflow: "hidden" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.7, color: "rgba(255,255,255,0.4)", fontWeight: 500, marginBottom: 6 }}>Monthly Recurring Revenue</div>
          <div style={{ fontFamily: MONO, fontSize: 32, fontWeight: 500, color: "#FE6E3E", lineHeight: 1, marginBottom: 6 }}>${data.mrr.toLocaleString()}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", display: "flex", alignItems: "center", gap: 5 }}>
            {data.mrr > 0 ? <><span style={{ color: "#FE6E3E", fontWeight: 600 }}>↑</span> First dollar. Build from here.</> : <><span style={{ color: "#FE6E3E", fontWeight: 600 }}>→</span> First dollar pending</>}
          </div>
          <div style={{ marginTop: 10, height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", background: "#FE6E3E", borderRadius: 2, width: `${Math.min((data.mrr / 50000) * 100, 100)}%` }} />
          </div>
          <div style={{ marginTop: 5, fontSize: 10, color: "rgba(255,255,255,0.4)", display: "flex", justifyContent: "space-between" }}>
            <span>$0</span><span>Target: $50K MRR</span>
          </div>
          <svg style={{ marginTop: 10 }} width="100%" height="28" viewBox={`0 0 ${sparkW} ${sparkH}`}>
            <polyline points={sparkPoints} fill="none" stroke="rgba(254,110,62,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={lastSparkX} cy={lastSparkY} r="3" fill="#FE6E3E" />
          </svg>
        </div>

        {/* Candidates Live */}
        <div style={{ background: "#fff", border: "1px solid #E8E6E1", borderRadius: 10, padding: "16px 18px", borderLeft: data.liveCandidates < 100 ? "3px solid #E24B4A" : "1px solid #E8E6E1" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.7, color: "#9C9A94", fontWeight: 500, marginBottom: 6 }}>Candidates Live</div>
          <div style={{ fontFamily: MONO, fontSize: 28, fontWeight: 500, color: "#1C1B1A", lineHeight: 1, marginBottom: 6 }}>{data.liveCandidates}</div>
          <div style={{ fontSize: 11, color: "#9C9A94", display: "flex", alignItems: "center", gap: 5 }}>
            {data.liveCandidates < 100
              ? <><span style={{ color: "#E24B4A", fontWeight: 600 }}>{100 - data.liveCandidates} below</span> seminar target</>
              : <><span style={{ color: "#3B9E5E", fontWeight: 600 }}>✓</span> Target reached</>}
          </div>
          <div style={{ marginTop: 10, height: 4, background: data.liveCandidates < 100 ? "#FEECEC" : "#EAF6EF", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", background: data.liveCandidates < 100 ? "#E24B4A" : "#3B9E5E", borderRadius: 2, width: `${Math.min((data.liveCandidates / 100) * 100, 100)}%` }} />
          </div>
          <div style={{ marginTop: 5, fontSize: 10, color: "#9C9A94", display: "flex", justifyContent: "space-between" }}>
            <span>{data.liveCandidates}</span><span>Goal: 100</span>
          </div>
        </div>

        {/* Active Engagements */}
        <div style={{ background: "#fff", border: "1px solid #E8E6E1", borderRadius: 10, padding: "16px 18px" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.7, color: "#9C9A94", fontWeight: 500, marginBottom: 6 }}>Active Engagements</div>
          <div style={{ fontFamily: MONO, fontSize: 28, fontWeight: 500, color: "#1C1B1A", lineHeight: 1, marginBottom: 6 }}>{data.activeEngagements}</div>
          <div style={{ fontSize: 11, color: "#9C9A94", display: "flex", alignItems: "center", gap: 5 }}>
            {data.newEngThisWeek > 0
              ? <><span style={{ color: "#3B9E5E", fontWeight: 600 }}>↑ {data.newEngThisWeek}</span> this week</>
              : <><span style={{ color: "#9C9A94", fontWeight: 600 }}>→</span> No new this week</>}
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: "#9C9A94" }}>
            Platform fee collected: <span style={{ color: "#FE6E3E", fontFamily: MONO }}>${data.platformFeeThisMonth.toLocaleString()}</span>
          </div>
        </div>

        {/* Warm Leads Going Cold */}
        <div style={{ background: "#fff", border: "1px solid #E8E6E1", borderRadius: 10, padding: "16px 18px", borderLeft: data.warmLeadsCount > 0 ? "3px solid #E24B4A" : "1px solid #E8E6E1" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.7, color: "#9C9A94", fontWeight: 500, marginBottom: 6 }}>Warm Leads Going Cold</div>
          <div style={{ fontFamily: MONO, fontSize: 28, fontWeight: 500, color: "#1C1B1A", lineHeight: 1, marginBottom: 6 }}>{data.warmLeadsCount}</div>
          <div style={{ fontSize: 11, color: "#9C9A94", display: "flex", alignItems: "center", gap: 5 }}>
            {data.warmLeadsCount > 0
              ? <span style={{ color: "#E24B4A", fontWeight: 600 }}>No contact in 14+ days</span>
              : <span style={{ color: "#3B9E5E", fontWeight: 600 }}>All leads engaged</span>}
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: "#9C9A94" }}>Browsed profiles. Never hired.</div>
        </div>
      </div>

      {/* ═══ ACTION CARDS ROW ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 18 }}>
        {/* Ready to Review */}
        <div style={{ background: "#fff", border: "1px solid #E8E6E1", borderRadius: 10, padding: "15px 18px", borderLeft: "3px solid #E24B4A" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>🔴 Ready to Review</div>
            <span style={{ fontSize: 10, color: "#9C9A94" }}>Admin action needed</span>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 500, marginBottom: 4 }}>{data.pendingCandidates.length}</div>
          <div style={{ fontSize: 11, color: "#9C9A94", lineHeight: 1.5, marginBottom: 12 }}>Candidates completed all steps and are waiting on your approval.</div>
          <button onClick={() => setModal("review")} style={{ ...btnStyle, background: "#E24B4A", color: "#fff", padding: "5px 10px", fontSize: 11.5 }}>Review Now →</button>
        </div>

        {/* Follow Up Today */}
        <div style={{ background: "#fff", border: "1px solid #E8E6E1", borderRadius: 10, padding: "15px 18px", borderLeft: "3px solid #EF9F27" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>🟡 Follow Up Today</div>
            <span style={{ fontSize: 10, color: "#9C9A94" }}>Conversion risk</span>
          </div>
          <div style={{ marginBottom: 10 }}>
            {data.warmLeads.slice(0, 3).map((lead) => (
              <div key={lead.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #F0EDE8", fontSize: 11.5 }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{lead.name}</div>
                  <div style={{ color: "#9C9A94", fontSize: 10.5 }}>{lead.activity}</div>
                </div>
                <span style={{ color: lead.isNew ? "#3B9E5E" : "#E24B4A", fontSize: 11, fontFamily: MONO }}>{lead.isNew ? "new" : `${lead.daysCold}d cold`}</span>
              </div>
            ))}
          </div>
          <button onClick={() => setModal("followup")} style={{ ...btnStyle, background: "transparent", border: "1px solid #E2DFD8", color: "#5C5A54", padding: "5px 10px", fontSize: 11.5 }}>View All {data.warmLeadsCount} →</button>
        </div>

        {/* Recruiter Alerts */}
        <div style={{ background: "#fff", border: "1px solid #E8E6E1", borderRadius: 10, padding: "15px 18px", borderLeft: "3px solid #3B8BD4" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>🔵 Recruiter Alerts</div>
            <span style={{ fontSize: 10, color: "#9C9A94" }}>Needs routing</span>
          </div>
          <div style={{ marginBottom: 10 }}>
            {data.recruiterAlerts.missingCalendar.slice(0, 1).map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #F0EDE8", fontSize: 11.5 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#E24B4A", flexShrink: 0 }} />
                  <span style={{ fontWeight: 500 }}>{r.name}</span>
                </div>
                <span style={{ color: "#9C9A94", fontSize: 10.5 }}>Calendar link missing</span>
                <span onClick={() => showToast(`✓ Alert sent to ${r.name}`)} style={{ color: "#FE6E3E", fontSize: 11, fontWeight: 500, cursor: "pointer", padding: "3px 7px", borderRadius: 5 }}>Fix →</span>
              </div>
            ))}
            {data.recruiterAlerts.needsRouting > 0 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #F0EDE8", fontSize: 11.5 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#EF9F27", flexShrink: 0 }} />
                  <span style={{ fontWeight: 500 }}>{data.recruiterAlerts.needsRouting} candidates</span>
                </div>
                <span style={{ color: "#9C9A94", fontSize: 10.5 }}>Needs Routing badge</span>
                <span onClick={() => setModal("route")} style={{ color: "#FE6E3E", fontSize: 11, fontWeight: 500, cursor: "pointer", padding: "3px 7px", borderRadius: 5 }}>Route →</span>
              </div>
            )}
            {data.recruiterAlerts.unreviewedByRecruiter.slice(0, 1).map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", fontSize: 11.5 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#EF9F27", flexShrink: 0 }} />
                  <span style={{ fontWeight: 500 }}>{r.name}</span>
                </div>
                <span style={{ color: "#9C9A94", fontSize: 10.5 }}>{r.count} unreviewed</span>
                <span onClick={() => showToast(`Opening ${r.name}'s queue...`)} style={{ color: "#FE6E3E", fontSize: 11, fontWeight: 500, cursor: "pointer", padding: "3px 7px", borderRadius: 5 }}>View →</span>
              </div>
            ))}
          </div>
          <button onClick={() => router.push("/admin/recruiters")} style={{ ...btnStyle, background: "transparent", border: "1px solid #E2DFD8", color: "#5C5A54", padding: "5px 10px", fontSize: 11.5 }}>Manage Team →</button>
        </div>
      </div>

      {/* ═══ PIPELINE FUNNEL ═══ */}
      <div style={{ background: "#fff", border: "1px solid #E8E6E1", borderRadius: 10, padding: "18px 20px", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Candidate Pipeline</div>
            <div style={{ fontSize: 11, color: "#9C9A94" }}>{data.pipeline.applied} total applications · {data.pipeline.live} approved · {conversionPct}% conversion</div>
          </div>
          <span onClick={() => setModal("pipeline")} style={{ fontSize: 11, color: "#FE6E3E", cursor: "pointer", fontWeight: 500, padding: "4px 8px", borderRadius: 5 }}>Full Breakdown →</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, alignItems: "end" }}>
          {pStages.map((s, i) => {
            const pct = totalApplied > 0 ? (s.count / totalApplied) * 100 : 0;
            const barH = Math.max(4, (s.count / totalApplied) * 70);
            const isLive = i === pStages.length - 1;
            return (
              <div key={s.label} style={{ textAlign: "center", cursor: "pointer" }} onClick={() => showToast(`${s.count} ${s.label.toLowerCase()} (${pct.toFixed(1)}%)`)}>
                <div style={{ height: 70, display: "flex", alignItems: "flex-end", justifyContent: "center", marginBottom: 6 }}>
                  <div style={{ width: "100%", borderRadius: "4px 4px 0 0", minHeight: 4, background: s.color, height: barH }} />
                </div>
                <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 500, color: isLive ? "#FE6E3E" : "#1C1B1A", marginBottom: 3 }}>{s.count}</div>
                <div style={{ fontSize: 9.5, color: isLive ? "#FE6E3E" : "#9C9A94", lineHeight: 1.3, fontWeight: isLive ? 600 : 400 }}>{s.label}</div>
                <div style={{ fontSize: 9, color: "#B8B5AE", fontFamily: MONO, marginTop: 2 }}>{pct.toFixed(0)}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ BOTTOM GRID ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
        {/* AI Screening Queue */}
        <div style={{ background: "#fff", border: "1px solid #E8E6E1", borderRadius: 10, padding: "18px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>AI Screening Queue</div>
              <div style={{ fontSize: 11, color: "#9C9A94" }}>Updates every 5 min · {data.screening.screenedToday} screened today</div>
            </div>
            <span onClick={() => { showToast("Refreshing screening queue..."); loadData(); }} style={{ fontSize: 11, color: "#FE6E3E", cursor: "pointer", fontWeight: 500, padding: "4px 8px", borderRadius: 5 }}>Refresh ↺</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {[
              { label: "Pending", count: data.screening.pending, bg: "#FFF8F0", color: "#BA7517" },
              { label: "Processing", count: data.screening.processing, bg: "#EEF5FF", color: "#185FA5" },
              { label: "Complete", count: data.screening.complete, bg: "#F0FAF4", color: "#3B6D11" },
              { label: "Failed", count: data.screening.failed, bg: "#FEF2F2", color: "#A32D2D" },
            ].map((b) => (
              <div key={b.label} style={{ borderRadius: 8, padding: "12px 10px", textAlign: "center", background: b.bg, cursor: "pointer" }} onClick={() => showToast(`${b.count} ${b.label.toLowerCase()}`)}>
                <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 500, color: b.color, marginBottom: 3 }}>{b.count}</div>
                <div style={{ fontSize: 10, color: "#9C9A94", fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.5 }}>{b.label}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>Identity & Lockouts</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {[
                { label: "Lockouts", count: data.identity.lockouts, color: "#1C1B1A" },
                { label: "Dupes/wk", count: data.identity.dupesWeek, color: "#1C1B1A" },
                { label: "Flagged", count: data.identity.flagged, color: "#1C1B1A" },
                { label: "Verified", count: data.identity.verified, color: "#3B9E5E" },
              ].map((c) => (
                <div key={c.label} style={{ textAlign: "center", cursor: "pointer" }} onClick={() => showToast(`${c.count} ${c.label.toLowerCase()}`)}>
                  <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 500, color: c.color, marginBottom: 3 }}>{c.count}</div>
                  <div style={{ fontSize: 10, color: "#9C9A94" }}>{c.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Platform Pulse */}
        <div style={{ background: "#fff", border: "1px solid #E8E6E1", borderRadius: 10, padding: "18px 20px" }}>
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Platform Pulse</div>
            <div style={{ fontSize: 11, color: "#9C9A94" }}>This week vs last week</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
            <PulseBox label="Applications / wk" value={data.pulse.applicationsThisWeek} trend={data.pulse.appChangePercent} onClick={() => showToast(`${data.pulse.applicationsThisWeek} applications this week`)} />
            <PulseBox label="New Clients / wk" value={data.pulse.clientsThisWeek} trend={data.pulse.clientWeekChange} onClick={() => showToast(`${data.pulse.clientsThisWeek} new clients this week`)} />
            {data.pulse.activeConversations === 0 ? (
              <div onClick={() => setModal("followup")} style={{ padding: 12, background: "#FEF8F8", borderRadius: 8, cursor: "pointer", border: "1px solid #FDDEDE" }}>
                <div style={{ fontSize: 10, color: "#9C9A94", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Active Conversations</div>
                <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 500, color: "#E24B4A" }}>0</div>
                <div style={{ fontSize: 10, color: "#E24B4A", fontWeight: 600 }}>→ Start outreach now</div>
              </div>
            ) : (
              <PulseBox label="Active Conversations" value={data.pulse.activeConversations} trend={0} onClick={() => showToast(`${data.pulse.activeConversations} active conversations`)} />
            )}
            <div style={{ padding: 12, background: "#F7F5F2", borderRadius: 8, cursor: "pointer" }} onClick={() => showToast(`${data.pulse.newCandidatesMonth} new candidates this month`)}>
              <div style={{ fontSize: 10, color: "#9C9A94", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>New Candidates / mo</div>
              <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 500 }}>{data.pulse.newCandidatesMonth}</div>
              <div style={{ fontSize: 10, color: data.pulse.newCandidatesMonth > 50 ? "#3B9E5E" : "#9C9A94", fontWeight: 600 }}>
                {data.pulse.newCandidatesMonth > 50 ? "↑ Strong pipeline" : "→ Building"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ CLIENT HEALTH TABLE ═══ */}
      <div style={{ background: "#fff", border: "1px solid #E8E6E1", borderRadius: 10, padding: "18px 20px", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Client Health</div>
            <div style={{ fontSize: 11, color: "#9C9A94" }}>{data.clientsThisMonth} clients this month</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FFF8F0", border: "1px solid #FDD4B8", borderRadius: 7, padding: "6px 10px", fontSize: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#EF9F27", flexShrink: 0 }} />
              <span style={{ color: "#8B4A1A" }}><strong>{data.talentPoolHealth.liveCandidates} live candidates</strong> · {data.talentPoolHealth.rolesBelow2} roles below healthy ratio</span>
            </div>
            <span onClick={() => router.push("/admin/clients")} style={{ fontSize: 11, color: "#FE6E3E", cursor: "pointer", fontWeight: 500, padding: "4px 8px", borderRadius: 5 }}>View All →</span>
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Client", "Last Login", "Browse Activity", "Engagements", "Total Fees", "Joined", "Status", ""].map((h) => (
                <th key={h} style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600, color: "#9C9A94", padding: "0 0 8px", textAlign: "left", borderBottom: "1px solid #F0EDE8" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.clientHealth.slice(0, 10).map((c) => (
              <tr key={c.id} onClick={() => showToast(`Opening ${c.name}'s client profile...`)} style={{ borderBottom: "1px solid #F7F5F2", cursor: "pointer" }}>
                <td style={{ padding: "9px 0", fontSize: 12 }}>
                  <div style={{ fontWeight: 500 }}>{c.name}</div>
                  <div style={{ fontSize: 10.5, color: "#9C9A94" }}>{c.email}</div>
                </td>
                <td style={{ padding: "9px 0", fontSize: 12, color: "#9C9A94" }}>{relativeTime(c.lastLogin)}</td>
                <td style={{ padding: "9px 0", fontSize: 11, color: c.browseActivity.includes("No") ? "#9C9A94" : "#1C1B1A" }}>{c.browseActivity}</td>
                <td style={{ padding: "9px 0", fontFamily: MONO, fontSize: 12, color: c.activeEngagements > 0 ? "#1C1B1A" : "#9C9A94" }}>{c.activeEngagements}</td>
                <td style={{ padding: "9px 0", fontFamily: MONO, fontSize: 12, color: c.totalFees > 0 ? "#FE6E3E" : "#9C9A94" }}>${c.totalFees.toLocaleString()}</td>
                <td style={{ padding: "9px 0", fontFamily: MONO, fontSize: 11, color: "#9C9A94" }}>{new Date(c.joined).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</td>
                <td style={{ padding: "9px 0" }}>
                  <span style={{
                    display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600, letterSpacing: 0.3,
                    background: c.status === "active" ? "#EAF6EF" : "#F2F1EE",
                    color: c.status === "active" ? "#2A7A48" : "#9C9A94",
                  }}>{c.status === "active" ? "Active" : "Inactive"}</span>
                </td>
                <td style={{ padding: "9px 0" }}>
                  <span
                    onClick={(e) => { e.stopPropagation(); showToast(c.status === "active" ? `Following up with ${c.name}` : `Browse link copied for ${c.name}`); }}
                    style={{ color: "#FE6E3E", fontSize: 11, fontWeight: 500, cursor: "pointer", padding: "3px 7px", borderRadius: 5 }}
                  >
                    {c.status === "active" ? "Follow up" : "Send browse link"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          MODALS
         ═══════════════════════════════════════════════════════════════ */}

      {/* REVIEW MODAL */}
      {modal === "review" && (
        <ModalShell title="🔴 Candidates Ready to Review" onClose={() => setModal(null)}
          footer={
            <>
              <button onClick={() => setModal(null)} style={{ ...btnStyle, background: "transparent", border: "1px solid #E2DFD8", color: "#5C5A54" }}>Close</button>
              <button onClick={() => { if (data.pendingCandidates[0]) handleRevision(data.pendingCandidates[0].id); }} style={{ ...btnStyle, background: "transparent", border: "1px solid #E2DFD8", color: "#5C5A54", fontSize: 11.5 }}>Send Revision</button>
              <button onClick={handleApproveAll} style={{ ...btnStyle, background: "#E24B4A", color: "#fff" }}>
                Approve {data.pendingCandidates.length > 1 ? `All ${data.pendingCandidates.length}` : ""} →
              </button>
            </>
          }
        >
          {data.pendingCandidates.map((c) => (
            <div key={c.id} style={{ border: "1px solid #E8E6E1", borderRadius: 10, padding: 16, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#FE6E3E", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 600, fontSize: 16, flexShrink: 0, overflow: "hidden" }}>
                  {c.profile_photo_url ? <img src={c.profile_photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (c.full_name || c.display_name || "?")[0]}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{c.full_name || c.display_name}</div>
                  <div style={{ fontSize: 11.5, color: "#9C9A94", marginTop: 2 }}>
                    {c.role_category} · {c.country || "—"} · ${(c.monthly_rate || 0).toLocaleString()}/mo
                  </div>
                </div>
              </div>
              {/* Badges */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {c.english_tier && <Badge bg="#EAF6EF" color="#2A7A48">English: {c.english_tier}</Badge>}
                {c.ai_interview_score > 0 && <Badge bg="#EEF5FF" color="#185FA5">AI Score: {c.ai_interview_score}/100</Badge>}
                <Badge bg="#FFF0EA" color="#C04A15">ID: {c.id_verification_status === "passed" ? "Verified" : c.id_verification_status}</Badge>
                {c.years_experience > 0 && <Badge bg="#F2F1EE" color="#5C5A54">{c.years_experience} yrs experience</Badge>}
              </div>
              {/* Scores */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
                <ScoreBox label="Grammar" value={`${c.english_mc_score || 0}%`} />
                <ScoreBox label="Comprehension" value={`${c.english_comprehension_score || 0}%`} />
                <ScoreBox label="AI Interview" value={`${c.ai_interview_score || 0}`} />
              </div>
              {/* Audio */}
              <AudioRow label="Oral Reading Recording" url={c.voice_recording_1_url} playing={playingAudio} onPlay={(url) => playAudio(url, "oral reading")} />
              <AudioRow label="Self Introduction" url={c.voice_recording_2_url} playing={playingAudio} onPlay={(url) => playAudio(url, "self introduction")} />
            </div>
          ))}
          {data.pendingCandidates.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#9C9A94" }}>No candidates pending review.</div>
          )}
        </ModalShell>
      )}

      {/* FOLLOW-UP MODAL */}
      {modal === "followup" && (
        <ModalShell title="🟡 Warm Leads Going Cold" onClose={() => setModal(null)}
          footer={
            <>
              <button onClick={() => setModal(null)} style={{ ...btnStyle, background: "transparent", border: "1px solid #E2DFD8", color: "#5C5A54" }}>Close</button>
              <button onClick={() => { showToast(`✓ Browse links sent to all ${data.warmLeads.length} clients`); setModal(null); }} style={{ ...btnStyle, background: "#FE6E3E", color: "#fff" }}>Send to All {data.warmLeads.length} →</button>
            </>
          }
        >
          <div style={{ fontSize: 12, color: "#9C9A94", marginBottom: 14 }}>These clients browsed the platform but never hired. Reach out personally — not a mass email.</div>
          {data.warmLeads.map((lead) => (
            <div key={lead.id} style={{ border: "1px solid #E8E6E1", borderRadius: 9, padding: "13px 16px", marginBottom: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{lead.name}</div>
              <div style={{ fontSize: 11.5, color: "#9C9A94", marginBottom: 10 }}>{lead.activity} · {lead.isNew ? "New client" : `${lead.daysCold} days with no engagement`}</div>
              <div style={{ display: "flex", gap: 7 }}>
                <button onClick={() => showToast(`✓ Browse link sent to ${lead.name}`)} style={{ ...btnStyle, background: "#FE6E3E", color: "#fff", padding: "5px 10px", fontSize: 11.5 }}>Send Browse Link</button>
                <button onClick={() => showToast("Opening message thread...")} style={{ ...btnStyle, background: "transparent", border: "1px solid #E2DFD8", color: "#5C5A54", padding: "5px 10px", fontSize: 11.5 }}>Message</button>
              </div>
            </div>
          ))}
        </ModalShell>
      )}

      {/* PIPELINE MODAL */}
      {modal === "pipeline" && (
        <ModalShell title="📊 Full Pipeline Breakdown" onClose={() => setModal(null)}
          footer={
            <>
              <button onClick={() => setModal(null)} style={{ ...btnStyle, background: "transparent", border: "1px solid #E2DFD8", color: "#5C5A54" }}>Close</button>
              <button onClick={() => { showToast(`✓ Nudge emails queued for ${biggestDrop.stuck} candidates`); setModal(null); }} style={{ ...btnStyle, background: "#FE6E3E", color: "#fff" }}>Send Nudge Emails →</button>
            </>
          }
        >
          <div style={{ background: "#FFF8F0", border: "1px solid #FDD4B8", borderRadius: 8, padding: "12px 14px", marginBottom: 16, fontSize: 12.5, color: "#8B4A1A" }}>
            <strong>Seminar target: 100 live candidates.</strong> You need to approve {candidatesNeeded} more in {daysUntilSeminar} days.
          </div>
          {pStages.map((s) => {
            const pct = totalApplied > 0 ? (s.count / totalApplied) * 100 : 0;
            const isLive = s.label === "Live ✓";
            return (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #F0EDE8" }}>
                <div style={{ fontSize: 12, width: 110, flexShrink: 0, color: isLive ? "#FE6E3E" : "#1C1B1A", fontWeight: isLive ? 600 : 400 }}>{s.label}</div>
                <div style={{ flex: 1, background: "#F0EDE8", borderRadius: 4, overflow: "hidden", height: 8 }}>
                  <div style={{ height: 8, borderRadius: 4, width: `${pct}%`, background: s.color, transition: "width 0.4s" }} />
                </div>
                <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 500, width: 30, flexShrink: 0, color: isLive ? "#FE6E3E" : "#1C1B1A" }}>{s.count}</div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: "#9C9A94", width: 36, textAlign: "right", flexShrink: 0 }}>{pct.toFixed(1)}%</div>
              </div>
            );
          })}
          <div style={{ marginTop: 16, padding: "12px 14px", background: "#F7F5F2", borderRadius: 8, fontSize: 12, color: "#5C5A54", lineHeight: 1.6 }}>
            <strong>Biggest drop-off:</strong> {biggestDrop.from} → {biggestDrop.to} ({biggestDrop.fromPct}% → {biggestDrop.toPct}%). {biggestDrop.stuck} candidates have completed {biggestDrop.from.toLowerCase()} but not started {biggestDrop.to.toLowerCase()}. Nudge emails to this cohort would move the needle fastest.
          </div>
        </ModalShell>
      )}

      {/* ROUTE MODAL */}
      {modal === "route" && (
        <ModalShell title="Route Candidates to Specialists" onClose={() => setModal(null)} width={440}
          footer={
            <>
              <button onClick={() => setModal(null)} style={{ ...btnStyle, background: "transparent", border: "1px solid #E2DFD8", color: "#5C5A54" }}>Cancel</button>
              <button onClick={handleSaveRoutes} style={{ ...btnStyle, background: "#FE6E3E", color: "#fff" }}>Save Assignments →</button>
            </>
          }
        >
          <div style={{ fontSize: 12, color: "#9C9A94", marginBottom: 14 }}>{data.routeCandidates.length} candidates selected &quot;Other&quot; as their role category and need manual routing.</div>
          {data.routeCandidates.map((c) => (
            <div key={c.id} style={{ border: "1px solid #E8E6E1", borderRadius: 9, padding: "13px 16px", marginBottom: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{c.full_name || c.display_name} — &quot;Other: {c.role_category}&quot;</div>
              <div style={{ fontSize: 11.5, color: "#9C9A94", marginBottom: 10 }}>Applied {new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {c.country || "—"} · ${(c.monthly_rate || 0).toLocaleString()}/mo</div>
              <select
                value={routeAssignments[c.id] || ""}
                onChange={(e) => setRouteAssignments((p) => ({ ...p, [c.id]: e.target.value }))}
                style={{ width: "100%", padding: "5px 8px", border: "1px solid #E2DFD8", borderRadius: 8, fontFamily: "'DM Sans', sans-serif", fontSize: 11.5, color: "#1C1B1A", background: "#fff" }}
              >
                <option value="">— Assign to Talent Specialist —</option>
                {data.recruiters.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          ))}
        </ModalShell>
      )}

      {/* EXPORT MODAL */}
      {modal === "export" && (
        <ModalShell title="Export Dashboard Data" onClose={() => setModal(null)} width={400}
          footer={<button onClick={() => setModal(null)} style={{ ...btnStyle, background: "transparent", border: "1px solid #E2DFD8", color: "#5C5A54" }}>Cancel</button>}
        >
          {[
            { type: "pipeline", icon: "📊", bg: "#EEF5FF", title: "Candidate Pipeline CSV", desc: `All ${data.pipeline.applied} candidates with stage, scores, and status` },
            { type: "clients", icon: "📋", bg: "#F0FAF4", title: "Client Health Report", desc: `All ${data.totalClients} clients with login, browse activity, and fees` },
            { type: "recruiter", icon: "👥", bg: "#FFF8F0", title: "Recruiter Performance", desc: "Assignment counts, review rates, and response times" },
          ].map((opt) => (
            <div key={opt.type} onClick={() => exportCSV(opt.type)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", border: "1px solid #E8E6E1", borderRadius: 9, marginBottom: 8, cursor: "pointer", transition: "all 0.12s" }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, background: opt.bg, flexShrink: 0 }}>{opt.icon}</div>
              <div>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{opt.title}</div>
                <div style={{ fontSize: 11, color: "#9C9A94" }}>{opt.desc}</div>
              </div>
            </div>
          ))}
        </ModalShell>
      )}

      {/* QUICK APPROVE MODAL */}
      {modal === "approve" && (
        <ModalShell title="Quick Approve Candidate" onClose={() => setModal(null)} width={380}
          footer={
            <>
              <button onClick={() => setModal(null)} style={{ ...btnStyle, background: "transparent", border: "1px solid #E2DFD8", color: "#5C5A54" }}>Cancel</button>
              <button onClick={() => { setModal("review"); }} style={{ ...btnStyle, background: "#FE6E3E", color: "#fff" }}>Go to Review Queue →</button>
            </>
          }
        >
          <div style={{ fontSize: 12.5, color: "#5C5A54", marginBottom: 14, lineHeight: 1.6 }}>Search for a candidate in the pending review queue to approve directly from the dashboard.</div>
          <input
            type="text"
            placeholder="Search by name or email..."
            value={approveSearch}
            onChange={(e) => setApproveSearch(e.target.value)}
            style={{ width: "100%", padding: "9px 12px", border: "1px solid #E2DFD8", borderRadius: 8, fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "#1C1B1A", marginBottom: 12, boxSizing: "border-box" }}
          />
          {approveSearch.length > 1 && (
            <div>
              {data.pendingCandidates
                .filter((c) => (c.full_name || c.display_name || "").toLowerCase().includes(approveSearch.toLowerCase()))
                .map((c) => (
                  <div
                    key={c.id}
                    onClick={() => { setModal("review"); }}
                    style={{ border: "1px solid #E8E6E1", borderRadius: 9, padding: "13px 16px", marginBottom: 10, cursor: "pointer" }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{c.full_name || c.display_name} — {c.role_category}</div>
                    <div style={{ fontSize: 11.5, color: "#9C9A94" }}>{c.country || "—"} · ${(c.monthly_rate || 0).toLocaleString()}/mo · AI Score {c.ai_interview_score || 0} · Ready to approve</div>
                  </div>
                ))}
            </div>
          )}
        </ModalShell>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════

const btnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 13px",
  borderRadius: 7,
  fontFamily: "'DM Sans', sans-serif",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  border: "none",
  transition: "all 0.15s",
};

function ModalShell({ title, onClose, children, footer, width }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number }) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, background: "rgba(28,27,26,0.55)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(2px)" }}>
      <div style={{ background: "#fff", borderRadius: 14, width: width || 520, maxWidth: "94vw", maxHeight: "82vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>
        <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid #F0EDE8", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #E2DFD8", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#9C9A94" }}>×</button>
        </div>
        <div style={{ padding: "20px 22px", overflowY: "auto", flex: 1 }}>{children}</div>
        {footer && (
          <div style={{ padding: "14px 22px", borderTop: "1px solid #F0EDE8", display: "flex", gap: 8, justifyContent: "flex-end", flexShrink: 0 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function Badge({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return <span style={{ display: "inline-block", padding: "3px 9px", borderRadius: 6, fontSize: 10.5, fontWeight: 500, background: bg, color }}>{children}</span>;
}

function ScoreBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#F7F5F2", borderRadius: 8, padding: 10, textAlign: "center" }}>
      <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 500, color: "#1C1B1A" }}>{value}</div>
      <div style={{ fontSize: 10, color: "#9C9A94", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function AudioRow({ label, url, playing, onPlay }: { label: string; url: string | null; playing: string | null; onPlay: (url: string | null) => void }) {
  return (
    <div onClick={() => onPlay(url)} style={{ display: "flex", alignItems: "center", gap: 10, background: "#F7F5F2", borderRadius: 8, padding: "10px 14px", marginBottom: 12, cursor: "pointer", transition: "background 0.12s" }}>
      <button style={{ width: 32, height: 32, borderRadius: "50%", background: "#FE6E3E", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, flexShrink: 0, border: "none", cursor: "pointer" }}>
        {playing === url ? "⏸" : "▶"}
      </button>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 10.5, color: "#9C9A94" }}>Tap to play</div>
      </div>
    </div>
  );
}

function PulseBox({ label, value, trend, onClick }: { label: string; value: number; trend: number; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{ padding: 12, background: "#F7F5F2", borderRadius: 8, cursor: "pointer", transition: "background 0.12s" }}>
      <div style={{ fontSize: 10, color: "#9C9A94", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 500, color: "#1C1B1A" }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: trend >= 0 ? "#3B9E5E" : "#E24B4A" }}>
        {trend >= 0 ? `↑ ${Math.abs(trend)}%` : `↓ ${Math.abs(trend)}%`} vs last wk
      </div>
    </div>
  );
}
