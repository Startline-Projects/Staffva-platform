"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/admin/Toast";
import { countByPriority, deriveAlerts, type AlertInput, type DerivedAlert } from "@/lib/adminAlerts";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface Pipeline {
  applied: number;
  englishPass: number;
  idVerified: number;
  profileBuilt: number;
  aiInterview: number;
  pendingProfileReview: number;
  live: number;
}

interface PendingCandidate {
  id: string;
  full_name: string;
  display_name: string;
  role_category: string;
  country: string;
  hourly_rate: number;
  english_written_tier: string;
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
  hourly_rate: number;
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
  pipeline: Pipeline;
  pendingCandidates: PendingCandidate[];
  warmLeads: WarmLead[];
  recruiterAlerts: { needsRouting: number };
  screening: { screenedToday: number };
  identity: { lockouts: number; flagged: number; verified: number };
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
  routeCandidates: RouteCandidate[];
  recruiters: { id: string; name: string }[];
}

/** The shape lives in `src/lib/adminAlerts.ts`; this is only the filter's own union. */
type Priority = "urgent" | "today" | "week";

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

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);


const ArrowIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function AdminDashboard() {
  const router = useRouter();
  const { showToast } = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<"all" | Priority>("all");
  // Whatever /api/admin/alerts fed deriveAlerts. Null until it answers, so the
  // rows it owns stay absent rather than rendering as zero.
  const [extra, setExtra] = useState<AlertInput | null>(null);
  const [routeAssignments, setRouteAssignments] = useState<Record<string, string>>({});
  const [approveSearch, setApproveSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /**
   * A failed read and an empty platform are different answers, and the old
   * dashboard could not tell them apart: it swallowed the error, left `data`
   * null, and sat on "Loading command center…" forever. Anything that is not
   * a usable payload is now an error the page states out loud.
   */
  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/command-center");
      if (res.status === 403) { router.replace("/recruiter"); return; }
      if (!res.ok) { setLoadError(`The command centre answered ${res.status}.`); setLoading(false); return; }
      const d = (await res.json()) as DashboardData;
      if (!d || typeof d.pipeline !== "object") { setLoadError("The command centre returned a payload this page cannot read."); setLoading(false); return; }
      setData(d);
      setLoadError(null);
    } catch {
      setLoadError("Could not reach the command centre.");
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { loadData(); }, [loadData]);

  // Vendor state, open disputes and specialist dormancy are not in the
  // command-centre payload, and all three belong in the alert list. One extra
  // light call rather than widening an endpoint that already runs thirty
  // queries.
  //
  // It takes the input the route fed deriveAlerts, not the rendered alerts.
  // This used to recover the numbers by regex-matching the leading digits off
  // alert titles, so rewording a title silently changed the dashboard's data —
  // and any row whose title did not happen to start with a number could not be
  // read back at all.
  useEffect(() => {
    let alive = true;
    fetch("/api/admin/alerts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.input) return;
        setExtra(d.input as AlertInput);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // The topbar's Export and Approve buttons live in the shell and reach the
  // page over this event. See AdminBar.
  useEffect(() => {
    function handleModal(e: Event) {
      const name = (e as CustomEvent).detail;
      if (name) setModal(name);
    }
    window.addEventListener("adc-open-modal", handleModal);
    return () => window.removeEventListener("adc-open-modal", handleModal);
  }, []);

  // One <audio> for the page, so pressing pause actually pauses. The old row
  // constructed a fresh Audio on every click and only ever flipped a label —
  // a second click started a second overlapping playback.
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  function playAudio(url: string | null, label: string) {
    if (!url) { showToast("No recording available"); return; }
    audioRef.current?.pause();
    if (playingAudio === url) { setPlayingAudio(null); audioRef.current = null; return; }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play().catch(() => { showToast("Failed to play audio"); setPlayingAudio(null); });
    audio.onended = () => setPlayingAudio(null);
    setPlayingAudio(url);
    showToast(`Playing ${label}…`);
  }

  async function handleApprove(candidateId: string) {
    setActionLoading(candidateId);
    try {
      const res = await fetch("/api/admin/candidates/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, action: "approve" }),
      });
      if (res.ok) {
        showToast("Candidate approved and live");
        await loadData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(`Error: ${err.error || "Failed"}`);
      }
    } catch { showToast("Network error"); }
    setActionLoading(null);
  }

  async function handleApproveAll() {
    if (!data) return;
    for (const c of data.pendingCandidates) await handleApprove(c.id);
  }

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
      if (res.ok) { showToast("Revision request sent"); await loadData(); }
    } catch { showToast("Network error"); }
    setActionLoading(null);
  }

  async function handleSaveRoutes() {
    if (!data) return;
    const unassigned = data.routeCandidates.filter((c) => !routeAssignments[c.id]);
    if (unassigned.length > 0) { showToast("Assign a specialist to every candidate first"); return; }

    for (const c of data.routeCandidates) {
      try {
        await fetch("/api/admin/candidates", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId: c.id, assigned_recruiter: routeAssignments[c.id], assignment_pending_review: false }),
        });
      } catch { /* continue — the rest of the batch still deserves a try */ }
    }
    showToast("Candidates routed");
    setModal(null);
    await loadData();
  }

  function exportCSV(type: string) {
    if (!data) return;
    let csv = "";
    let filename = "";

    if (type === "pipeline") {
      csv = "Stage,Count,Percentage\n";
      const stages: [string, number][] = [
        ["Applied", data.pipeline.applied],
        ["English Pass", data.pipeline.englishPass],
        ["ID Verified", data.pipeline.idVerified],
        ["Profile Built", data.pipeline.profileBuilt],
        ["AI Interview", data.pipeline.aiInterview],
        ["Profile Under Review", data.pipeline.pendingProfileReview],
        ["Live", data.pipeline.live],
      ];
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
    } else return;

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`${filename} exported`);
    setModal(null);
  }

  // ═══ ALERTS ═══
  // Derived in `src/lib/adminAlerts.ts`, shared with the topbar bell. Two
  // copies of "what counts as urgent" would have drifted the first time
  // either changed, and the bell has to answer the same question from every
  // other page in the panel.
  //
  // The vendor and dispute rows come from the bell's own endpoint rather than
  // the command centre, which does not report either — so the dashboard asks
  // for them alongside its own payload.
  const alerts: DerivedAlert[] = useMemo(() => {
    if (!data) return [];
    return deriveAlerts({
      totalCandidates: data.pipeline.applied,
      pendingProfileReview: data.pipeline.pendingProfileReview,
      needsRouting: data.recruiterAlerts.needsRouting,
      screeningHold: data.identity.flagged,
      testLockouts: data.identity.lockouts,
      coldClients: data.warmLeadsCount,
      thinRoles: data.talentPoolHealth.rolesBelow2,
      // The command centre knows none of these; they arrive from the bell's
      // endpoint. Until it answers, they are absent rather than zero.
      pendingBans: extra?.pendingBans ?? 0,
      openDisputes: extra?.openDisputes ?? 0,
      vendorsDown: extra?.vendorsDown ?? [],
      assignedToDormant: extra?.assignedToDormant,
      dormantSpecialists: extra?.dormantSpecialists,
      longestDormancyDays: extra?.longestDormancyDays,
      unassignedLive: extra?.unassignedLive,
      awaitingReply: extra?.awaitingReply,
      awaitingReplyOnDormant: extra?.awaitingReplyOnDormant,
      longestWaitDays: extra?.longestWaitDays,
      neverAnswered: extra?.neverAnswered,
    });
  }, [data, extra]);

  const counts = useMemo(() => countByPriority(alerts), [alerts]);

  const shownAlerts = priorityFilter === "all" ? alerts : alerts.filter((a) => a.priority === priorityFilter);

  // ═══ STATES ═══
  if (loading) {
    return (
      <div className="adm-body">
        <div className="adm-col">
          <div className="adm-skeleton" style={{ height: 90, marginBottom: 26 }} />
          <div className="adm-skeleton" style={{ height: 44, marginBottom: 14, width: 280 }} />
          <div className="adm-skeleton" style={{ height: 68, marginBottom: 8 }} />
          <div className="adm-skeleton" style={{ height: 68, marginBottom: 8 }} />
          <div className="adm-skeleton" style={{ height: 68 }} />
        </div>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="adm-state error" role="alert">
        <strong>The dashboard could not load.</strong>
        <p style={{ marginTop: 8 }}>{loadError ?? "No data was returned."}</p>
        <button className="adm-btn" style={{ marginTop: 16 }} onClick={() => { setLoading(true); setLoadError(null); loadData(); }}>
          Try again
        </button>
      </div>
    );
  }

  // ═══ COMPUTED ═══
  const pStages = [
    { label: "Applied", count: data.pipeline.applied },
    { label: "English pass", count: data.pipeline.englishPass },
    { label: "ID verified", count: data.pipeline.idVerified },
    { label: "Profile built", count: data.pipeline.profileBuilt },
    { label: "AI interview", count: data.pipeline.aiInterview },
    { label: "Under review", count: data.pipeline.pendingProfileReview, tone: "review" as const },
    { label: "Live", count: data.pipeline.live, tone: "terminal" as const },
  ];
  const totalApplied = data.pipeline.applied || 1;
  const conversionPct = ((data.pipeline.live / totalApplied) * 100).toFixed(1);

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

  const spark = data.mrrSparkline?.length ? data.mrrSparkline : [];
  const sparkMax = Math.max(...spark, 1);

  const today = new Date();
  const dateLine = today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).toUpperCase();

  const delta = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "flat");
  const deltaText = (n: number) => (n > 0 ? `+${n}%` : n < 0 ? `${n}%` : "±0%");

  return (
    <div className="adm-body">
      <div className="adm-col">
        {/* ═══ HEADER ═══ */}
        <header className="adm-page-header">
          <div>
            <div className="adm-eyebrow">{dateLine}</div>
            <h1>
              Command <span className="adm-serif-italic">centre.</span>
            </h1>
            <div className="adm-subhead">
              {alerts.length === 0
                ? "Nothing needs you right now"
                : `${alerts.length} ${plural(alerts.length, "item")} ${plural(alerts.length, "needs", "need")} your attention`}
              <span className="sep">·</span>
              {data.pipeline.live} live {plural(data.pipeline.live, "candidate")}
            </div>
          </div>
        </header>

        {/* ═══ ALERTS ═══ */}
        <section className="adm-section">
          <div className="adm-section-head">
            <h2>
              Needs your attention
              {alerts.length > 0 && <span className="count">{alerts.length} open</span>}
            </h2>
          </div>

          {alerts.length > 0 && (
            <div className="alerts-filter-row" role="tablist" aria-label="Filter alerts by priority">
              {(["all", "urgent", "today", "week"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={priorityFilter === p}
                  className={`alerts-filter${priorityFilter === p ? " active" : ""}`}
                  data-priority={p === "all" ? undefined : p}
                  onClick={() => setPriorityFilter(p)}
                >
                  {p !== "all" && <span className="filter-dot" aria-hidden="true" />}
                  {p === "all" ? "All" : p === "week" ? "This week" : p}
                  <span className="filter-count">{counts[p]}</span>
                </button>
              ))}
            </div>
          )}

          {shownAlerts.length > 0 ? (
            <div className="alerts-list">
              {shownAlerts.map((a) => (
                <AlertCard key={a.id} alert={a} onModal={setModal} />
              ))}
            </div>
          ) : (
            <div className="alerts-empty">
              <div className="empty-icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 13 4 4L19 7" />
                </svg>
              </div>
              <h3>{alerts.length === 0 ? "Queue is clear" : "Nothing at this priority"}</h3>
              <p>
                {alerts.length === 0
                  ? "No profile reviews, no unrouted candidates, no lockouts, no cold clients."
                  : "Other priorities still have open items — switch the filter above."}
              </p>
            </div>
          )}
        </section>

        {/* ═══ STAT BAND ═══ */}
        <section className="adm-section">
          <div className="adm-section-head">
            <h2>Platform</h2>
            <button type="button" className="adm-section-action" onClick={() => setModal("export")}>Export data →</button>
          </div>
          <div className="stat-grid">
            <div className="stat-cell">
              <div className="stat-label">Platform fees · active</div>
              <div className="stat-value"><span className="currency-prefix">$</span>{data.mrr.toLocaleString()}</div>
              {spark.length > 1 && (
                <div className="stat-spark" aria-hidden="true">
                  {spark.map((v, i) => (
                    <span key={i} className={`bar${v === sparkMax && v > 0 ? " peak" : ""}`} style={{ height: `${Math.max(4, (v / sparkMax) * 100)}%` }} />
                  ))}
                </div>
              )}
            </div>
            <div className="stat-cell">
              <div className="stat-label">Live candidates</div>
              <div className="stat-value">{data.liveCandidates.toLocaleString()}</div>
              <div className="stat-detail">
                <strong>{data.pipeline.applied.toLocaleString()}</strong> applied · <strong>{conversionPct}%</strong> reach live
              </div>
            </div>
            <div className="stat-cell">
              <div className="stat-label">Active engagements</div>
              <div className="stat-value">{data.activeEngagements.toLocaleString()}</div>
              <div className="stat-detail">
                <strong>{data.newEngThisWeek}</strong> started this week
              </div>
            </div>
            <div className="stat-cell">
              <div className="stat-label">Clients</div>
              <div className="stat-value">
                {data.totalClients.toLocaleString()}
                <span className={`delta ${delta(data.pulse.clientWeekChange)}`}>{deltaText(data.pulse.clientWeekChange)}</span>
              </div>
              <div className="stat-detail">
                <strong>{data.clientsThisMonth}</strong> joined this month
              </div>
            </div>
          </div>
        </section>

        {/* ═══ PIPELINE ═══ */}
        <section className="adm-section">
          <div className="adm-section-head">
            <h2>
              Candidate pipeline
              <span className="count">{conversionPct}% conversion</span>
            </h2>
            <button type="button" className="adm-section-action" onClick={() => setModal("pipeline")}>Full breakdown →</button>
          </div>
          <div className="adm-panel">
            <div className="adm-panel-body">
              <div className="adm-funnel">
                {pStages.map((s) => (
                  <div key={s.label} className="adm-funnel-row">
                    <span className="adm-funnel-label">{s.label}</span>
                    <div className="adm-funnel-track">
                      <div
                        className={`adm-funnel-fill${s.tone ? ` ${s.tone}` : ""}`}
                        style={{ width: `${totalApplied > 0 ? (s.count / totalApplied) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="adm-funnel-count">{s.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
              {biggestDrop.stuck > 0 && (
                <p className="adm-funnel-note">
                  Biggest drop-off: <strong>{biggestDrop.from} → {biggestDrop.to}</strong> ({biggestDrop.fromPct}% → {biggestDrop.toPct}%).{" "}
                  {biggestDrop.stuck.toLocaleString()} {plural(biggestDrop.stuck, "candidate")} cleared {biggestDrop.from.toLowerCase()} and stopped there.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ═══ SCREENING + PULSE ═══ */}
        <section className="adm-section">
          <div className="adm-grid-2">
            <div className="adm-panel">
              <div className="adm-panel-header">Screening</div>
              <div className="adm-panel-body">
                <div className="adm-metric-grid">
                  <div className="adm-metric static">
                    <div className="adm-metric-label">Screened today</div>
                    <div className="adm-metric-value">{data.screening.screenedToday.toLocaleString()}</div>
                  </div>
                  <div className="adm-metric static">
                    <div className="adm-metric-label">Flagged · hold</div>
                    <div className="adm-metric-value">{data.identity.flagged.toLocaleString()}</div>
                  </div>
                  <div className="adm-metric static">
                    <div className="adm-metric-label">ID verified</div>
                    <div className="adm-metric-value">{data.identity.verified.toLocaleString()}</div>
                  </div>
                  <Link href="/admin/lockouts" className="adm-metric" style={{ display: "block", textDecoration: "none" }}>
                    <div className="adm-metric-label">Test lockouts</div>
                    <div className="adm-metric-value">{data.identity.lockouts.toLocaleString()}</div>
                  </Link>
                </div>
              </div>
            </div>

            <div className="adm-panel">
              <div className="adm-panel-header">This week</div>
              <div className="adm-panel-body">
                <div className="adm-metric-grid">
                  <div className="adm-metric static">
                    <div className="adm-metric-label">Applications</div>
                    <div className="adm-metric-value">{data.pulse.applicationsThisWeek}</div>
                    <div className={`adm-metric-trend ${delta(data.pulse.appChangePercent)}`}>
                      {deltaText(data.pulse.appChangePercent)} vs last week
                    </div>
                  </div>
                  <div className="adm-metric static">
                    <div className="adm-metric-label">New clients</div>
                    <div className="adm-metric-value">{data.pulse.clientsThisWeek}</div>
                    <div className={`adm-metric-trend ${delta(data.pulse.clientWeekChange)}`}>
                      {deltaText(data.pulse.clientWeekChange)} vs last week
                    </div>
                  </div>
                  <div className="adm-metric static">
                    <div className="adm-metric-label">Live conversations</div>
                    <div className="adm-metric-value">{data.pulse.activeConversations}</div>
                  </div>
                  <div className="adm-metric static">
                    <div className="adm-metric-label">New candidates · month</div>
                    <div className="adm-metric-value">{data.pulse.newCandidatesMonth}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ CLIENT HEALTH ═══ */}
        <section className="adm-section">
          <div className="adm-section-head">
            <h2>
              Client health
              <span className="count">{data.clientHealth.length} shown</span>
            </h2>
            <Link href="/admin/clients" className="adm-section-action">All clients →</Link>
          </div>
          <div className="adm-panel">
            {data.clientHealth.length > 0 ? (
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Last seen</th>
                      <th>Browsing</th>
                      <th style={{ textAlign: "right" }}>Engagements</th>
                      <th style={{ textAlign: "right" }}>Fees</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.clientHealth.map((c) => (
                      <tr key={c.id}>
                        <td className="name">{c.name}</td>
                        <td className="num">{relativeTime(c.lastLogin)}</td>
                        <td>{c.browseActivity}</td>
                        <td className="num" style={{ textAlign: "right" }}>{c.activeEngagements}</td>
                        <td className="num" style={{ textAlign: "right" }}>${c.totalFees.toLocaleString()}</td>
                        <td>
                          <span className={`adm-pill ${c.status === "active" ? "ok" : "cold"}`}>{c.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="adm-panel-body" style={{ color: "var(--ink-mute)", fontSize: 13 }}>
                No clients have signed up yet.
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ═══ RAIL ═══ */}
      <aside className="adm-rail" aria-label="Quick actions and today's numbers">
        <div className="rail-block">
          <div className="rail-block-header">Quick actions</div>
          <div className="rail-block-body">
            <button type="button" className="quick-action" onClick={() => setModal("review")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></svg>
              <span className="qa-label">Review profiles</span>
              <span className="audit-badge">Logged</span>
            </button>
            <button type="button" className="quick-action" onClick={() => setModal("route")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2.5-7 5 14 2.5-7h4" /></svg>
              <span className="qa-label">Route candidates</span>
            </button>
            <button type="button" className="quick-action" onClick={() => setModal("export")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M8 11l4 4 4-4M4 20h16" /></svg>
              <span className="qa-label">Export CSV</span>
            </button>
          </div>
        </div>

        <div className="rail-block">
          <div className="rail-block-header">Today at a glance</div>
          <div className="rail-glance-body">
            <div className="rail-glance-row">
              <span className="k">Awaiting review</span>
              <span className={`v${data.pipeline.pendingProfileReview > 0 ? " warn" : ""}`}>{data.pipeline.pendingProfileReview}</span>
            </div>
            <div className="rail-glance-row">
              <span className="k">Unrouted</span>
              <span className={`v${data.recruiterAlerts.needsRouting > 0 ? " bad" : ""}`}>{data.recruiterAlerts.needsRouting}</span>
            </div>
            <div className="rail-glance-row">
              <span className="k">Screened today</span>
              <span className="v">{data.screening.screenedToday}</span>
            </div>
            <div className="rail-glance-row">
              <span className="k">Flagged · hold</span>
              <span className={`v${data.identity.flagged > 0 ? " warn" : ""}`}>{data.identity.flagged}</span>
            </div>
            <div className="rail-glance-row">
              <span className="k">Test lockouts</span>
              <span className="v">{data.identity.lockouts}</span>
            </div>
            <div className="rail-glance-row">
              <span className="k">Cold clients</span>
              <span className="v">{data.warmLeadsCount}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* ═══════════════════════════════════════════════════════════════
          MODALS
         ═══════════════════════════════════════════════════════════════ */}

      {modal === "review" && (
        <ModalShell
          title="Candidates ready to review"
          onClose={() => setModal(null)}
          wide
          footer={
            <>
              <button className="adm-btn" onClick={() => setModal(null)}>Close</button>
              <button
                className="adm-btn"
                disabled={data.pendingCandidates.length === 0 || actionLoading !== null}
                onClick={() => { if (data.pendingCandidates[0]) handleRevision(data.pendingCandidates[0].id); }}
              >
                Send revision
              </button>
              <button
                className="adm-btn primary"
                disabled={data.pendingCandidates.length === 0 || actionLoading !== null}
                onClick={handleApproveAll}
              >
                {actionLoading ? "Approving…" : `Approve ${data.pendingCandidates.length > 1 ? `all ${data.pendingCandidates.length}` : ""}`}
              </button>
            </>
          }
        >
          {data.pendingCandidates.map((c) => (
            <div key={c.id} className="adm-cand">
              <div className="adm-cand-head">
                <div className="adm-cand-avatar">
                  {c.profile_photo_url
                    /* eslint-disable-next-line @next/next/no-img-element */
                    ? <img src={c.profile_photo_url} alt="" />
                    : (c.full_name || c.display_name || "?")[0]}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="adm-cand-name">{c.full_name || c.display_name}</div>
                  <div className="adm-cand-meta">
                    {c.role_category} · {c.country || "—"} · ${(c.hourly_rate || 0).toLocaleString()}/hr
                  </div>
                </div>
              </div>

              <div className="adm-badges">
                {c.english_written_tier && <span className="adm-badge good">English: {c.english_written_tier}</span>}
                {c.ai_interview_score > 0 && <span className="adm-badge info">AI {c.ai_interview_score}/100</span>}
                <span className={`adm-badge ${c.id_verification_status === "passed" ? "good" : "warm"}`}>
                  ID: {c.id_verification_status === "passed" ? "verified" : c.id_verification_status || "none"}
                </span>
                {c.years_experience > 0 && <span className="adm-badge">{c.years_experience} yrs</span>}
              </div>

              <div className="adm-scores">
                <div className="adm-score"><div className="adm-score-v">{c.english_mc_score || 0}%</div><div className="adm-score-k">Grammar</div></div>
                <div className="adm-score"><div className="adm-score-v">{c.english_comprehension_score || 0}%</div><div className="adm-score-k">Comprehension</div></div>
                <div className="adm-score"><div className="adm-score-v">{c.ai_interview_score || 0}</div><div className="adm-score-k">AI interview</div></div>
              </div>

              <AudioRow label="Oral reading" url={c.voice_recording_1_url} playing={playingAudio} onPlay={(u) => playAudio(u, "oral reading")} />
              <AudioRow label="Self introduction" url={c.voice_recording_2_url} playing={playingAudio} onPlay={(u) => playAudio(u, "self introduction")} />
            </div>
          ))}
          {data.pendingCandidates.length === 0 && (
            <p className="adm-modal-lead" style={{ marginBottom: 0 }}>No candidates are pending review.</p>
          )}
        </ModalShell>
      )}

      {modal === "followup" && (
        <ModalShell
          title="Clients who browsed and never hired"
          onClose={() => setModal(null)}
          footer={<button className="adm-btn" onClick={() => setModal(null)}>Close</button>}
        >
          <p className="adm-modal-lead">
            These clients signed up and looked around but have no active engagement. Reach out from their
            profile — there is no outreach endpoint wired to this screen yet, so nothing here sends mail.
          </p>
          {data.warmLeads.map((lead) => (
            <div key={lead.id} className="adm-row">
              <div style={{ minWidth: 0 }}>
                <div className="adm-row-name">{lead.name}</div>
                <div className="adm-row-meta">
                  {lead.activity} · {lead.isNew ? "new client" : `${lead.daysCold} days quiet`}
                </div>
              </div>
              <Link href="/admin/clients" className="adm-btn">Open client</Link>
            </div>
          ))}
          {data.warmLeads.length === 0 && <p className="adm-modal-lead" style={{ marginBottom: 0 }}>No cold clients right now.</p>}
        </ModalShell>
      )}

      {modal === "pipeline" && (
        <ModalShell
          title="Full pipeline breakdown"
          onClose={() => setModal(null)}
          footer={<button className="adm-btn" onClick={() => setModal(null)}>Close</button>}
        >
          <div className="adm-funnel">
            {pStages.map((s) => {
              const pct = totalApplied > 0 ? (s.count / totalApplied) * 100 : 0;
              return (
                <div key={s.label} className="adm-funnel-row">
                  <span className="adm-funnel-label">{s.label}</span>
                  <div className="adm-funnel-track">
                    <div className={`adm-funnel-fill${s.tone ? ` ${s.tone}` : ""}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="adm-funnel-count">{s.count.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
          {biggestDrop.stuck > 0 && (
            <p className="adm-funnel-note">
              <strong>Biggest drop-off:</strong> {biggestDrop.from} → {biggestDrop.to} ({biggestDrop.fromPct}% → {biggestDrop.toPct}%).{" "}
              {biggestDrop.stuck.toLocaleString()} {plural(biggestDrop.stuck, "candidate")} completed {biggestDrop.from.toLowerCase()} and never started {biggestDrop.to.toLowerCase()}.
            </p>
          )}
        </ModalShell>
      )}

      {modal === "route" && (
        <ModalShell
          title="Route candidates to specialists"
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="adm-btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="adm-btn primary" disabled={data.routeCandidates.length === 0} onClick={handleSaveRoutes}>
                Save assignments
              </button>
            </>
          }
        >
          <p className="adm-modal-lead">
            {data.routeCandidates.length} {plural(data.routeCandidates.length, "candidate")} {plural(data.routeCandidates.length, "is", "are")} waiting on a specialist.
          </p>
          {data.routeCandidates.map((c) => (
            <div key={c.id} className="adm-cand">
              <div className="adm-cand-name">{c.full_name || c.display_name}</div>
              <div className="adm-cand-meta" style={{ marginBottom: 10 }}>
                {c.role_category} · applied {new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {c.country || "—"}
              </div>
              <label className="adm-field-label" htmlFor={`route-${c.id}`}>Talent specialist</label>
              <select
                id={`route-${c.id}`}
                className="adm-select"
                value={routeAssignments[c.id] || ""}
                onChange={(e) => setRouteAssignments((p) => ({ ...p, [c.id]: e.target.value }))}
              >
                <option value="">— Assign —</option>
                {data.recruiters.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          ))}
          {data.routeCandidates.length === 0 && <p className="adm-modal-lead" style={{ marginBottom: 0 }}>Nothing is waiting to be routed.</p>}
        </ModalShell>
      )}

      {modal === "export" && (
        <ModalShell
          title="Export dashboard data"
          onClose={() => setModal(null)}
          footer={<button className="adm-btn" onClick={() => setModal(null)}>Cancel</button>}
        >
          {[
            { type: "pipeline", title: "Candidate pipeline", desc: `${data.pipeline.applied.toLocaleString()} candidates by stage` },
            { type: "clients", title: "Client health", desc: `${data.clientHealth.length} clients with activity and fees` },
          ].map((opt) => (
            <button key={opt.type} type="button" className="adm-audio" onClick={() => exportCSV(opt.type)}>
              <span className="adm-audio-btn" aria-hidden="true">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M8 11l4 4 4-4M4 20h16" /></svg>
              </span>
              <span>
                <span className="adm-audio-label">{opt.title}</span>
                <span className="adm-audio-sub" style={{ display: "block" }}>{opt.desc}</span>
              </span>
            </button>
          ))}
        </ModalShell>
      )}

      {modal === "approve" && (
        <ModalShell
          title="Quick approve"
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="adm-btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="adm-btn primary" onClick={() => setModal("review")}>Open review queue</button>
            </>
          }
        >
          <p className="adm-modal-lead">Find someone already in the review queue and approve them from here.</p>
          <input
            type="text"
            className="adm-input"
            placeholder="Search by name…"
            value={approveSearch}
            onChange={(e) => setApproveSearch(e.target.value)}
          />
          <div style={{ marginTop: 12 }}>
            {approveSearch.trim().length > 1 &&
              data.pendingCandidates
                .filter((c) => (c.full_name || c.display_name || "").toLowerCase().includes(approveSearch.trim().toLowerCase()))
                .map((c) => (
                  <div key={c.id} className="adm-row">
                    <div style={{ minWidth: 0 }}>
                      <div className="adm-row-name">{c.full_name || c.display_name}</div>
                      <div className="adm-row-meta">
                        {c.role_category} · {c.country || "—"} · AI {c.ai_interview_score || 0}
                      </div>
                    </div>
                    <button className="adm-btn primary" disabled={actionLoading === c.id} onClick={() => handleApprove(c.id)}>
                      {actionLoading === c.id ? "Approving…" : "Approve"}
                    </button>
                  </div>
                ))}
            {approveSearch.trim().length > 1 &&
              data.pendingCandidates.filter((c) => (c.full_name || c.display_name || "").toLowerCase().includes(approveSearch.trim().toLowerCase())).length === 0 && (
                <p className="adm-modal-lead" style={{ marginBottom: 0 }}>Nobody in the review queue matches that.</p>
              )}
          </div>
        </ModalShell>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function AlertCard({ alert, onModal }: { alert: DerivedAlert; onModal: (name: string) => void }) {
  const body = (
    <>
      <span className="alert-priority-tag">{alert.priority === "week" ? "This week" : alert.priority}</span>
      <span className="alert-content">
        <span className="alert-title" style={{ display: "block" }}>{alert.title}</span>
        <span className="alert-detail">
          {alert.meta.map((m, i) => (
            <span key={i}>
              {i > 0 && <span className="meta-sep"> · </span>}
              {m}
            </span>
          ))}
          {alert.sla && <span className={`sla ${alert.sla.tone}`}>{alert.sla.text}</span>}
        </span>
      </span>
      <span className="alert-action">
        {alert.actionLabel}
        <ArrowIcon />
      </span>
    </>
  );

  if (alert.href) {
    return (
      <Link href={alert.href} className="alert-card" data-priority={alert.priority}>
        {body}
      </Link>
    );
  }

  // A row that names a modal opens it here; the bell, which has no modals,
  // follows the same row's `bellHref` instead.
  return (
    <button
      type="button"
      className="alert-card"
      data-priority={alert.priority}
      onClick={() => alert.modal && onModal(alert.modal)}
    >
      {body}
    </button>
  );
}

function ModalShell({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="adm-modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`adm-modal${wide ? " wide" : ""}`}>
        <div className="adm-modal-head">
          <h2 className="adm-modal-title">{title}</h2>
          <button type="button" className="adm-modal-close" onClick={onClose} aria-label="Close">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="adm-modal-body">{children}</div>
        {footer && <div className="adm-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

function AudioRow({
  label,
  url,
  playing,
  onPlay,
}: {
  label: string;
  url: string | null;
  playing: string | null;
  onPlay: (url: string | null) => void;
}) {
  return (
    <button type="button" className="adm-audio" disabled={!url} onClick={() => onPlay(url)}>
      <span className="adm-audio-btn" aria-hidden="true">{playing === url ? "❚❚" : "▶"}</span>
      <span>
        <span className="adm-audio-label" style={{ display: "block" }}>{label}</span>
        <span className="adm-audio-sub">{url ? (playing === url ? "Playing — tap to stop" : "Tap to play") : "Not recorded"}</span>
      </span>
    </button>
  );
}
