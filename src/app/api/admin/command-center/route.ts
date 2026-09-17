import { NextResponse } from "next/server";
import { FailedReads, changePercentOrNull, countOrNull } from "@/lib/readCount";
import type { DashboardData } from "@/lib/adminDashboardTypes";
import { LIVE_STATUS, LIVE_STATUSES, isLive } from "@/lib/candidateStatus";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const admin = getAdminClient();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // ═══ PARALLEL FETCH BLOCK 1 — Core counts ═══
  const [
    liveCandidatesRes,
    totalCandidatesRes,
    activeEngRes,
    activeEngDataRes,
    newEngThisWeekRes,
    pendingReviewRes,
    englishPassRes,
    idVerifiedRes,
    profileBuiltRes,
    aiInterviewRes,
    pendingProfileReviewRes,
    triageRes,
    clientsTotalRes,
    clientsThisMonthRes,
    clientsThisWeekRes,
    clientsLastWeekRes,
    candidatesThisWeekRes,
    candidatesLastWeekRes,
    candidatesThisMonthRes,
    lockoutsRes,
    flaggedRes,
    verifiedRes,
    threadDataRes,
    talentSpecialistsRes,
    routeCandidatesRes,
    pendingBansRes,
  ] = await Promise.all([
    // Live candidates
    admin.from("candidates").select("id", { count: "exact", head: true }).in("admin_status", LIVE_STATUSES),
    // Total candidates (applied)
    admin.from("candidates").select("id", { count: "exact", head: true }),
    // Active engagements count
    admin.from("engagements").select("id", { count: "exact", head: true }).eq("status", "active"),
    // Active engagements with fees
    admin.from("engagements").select("platform_fee_usd").eq("status", "active"),
    // New engagements this week
    admin.from("engagements").select("id", { count: "exact", head: true }).eq("status", "active").gte("created_at", weekAgo),
    // Pending review (for sidebar badge) — includes active + profile_review
    admin.from("candidates").select("id", { count: "exact", head: true }).in("admin_status", ["active", "profile_review"]),
    // Pipeline: English pass
    admin.from("candidates").select("id", { count: "exact", head: true }).gte("english_mc_score", 70).gte("english_comprehension_score", 70),
    // Pipeline: ID verified
    admin.from("candidates").select("id", { count: "exact", head: true }).eq("id_verification_status", "passed"),
    // Pipeline: Profile built (photo + tagline + bio + payout + consent).
    // The résumé left this list when candidates stopped uploading one — kept
    // as a condition it would have counted zero new candidates forever.
    admin.from("candidates").select("id", { count: "exact", head: true })
      .not("profile_photo_url", "is", null)
      .not("tagline", "is", null)
      .not("bio", "is", null)
      .not("payout_method", "is", null)
      .eq("interview_consent", true),
    // Pipeline: AI interview completed
    admin.from("candidates").select("id", { count: "exact", head: true }).not("ai_interview_completed_at", "is", null),
    // Pipeline: Pending Profile Review (step 10 — profile review before push live)
    admin.from("candidates").select("id", { count: "exact", head: true }).in("admin_status", ["pending_review", "profile_review"]),
    // Triage queue count (sidebar badge)
    admin.from("candidates").select("id", { count: "exact", head: true }).eq("assignment_pending_review", true),
    // Total clients
    admin.from("clients").select("id", { count: "exact", head: true }),
    // Clients this month
    admin.from("clients").select("id", { count: "exact", head: true }).gte("created_at", monthStart),
    // Clients this week
    admin.from("clients").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    // Clients last week
    admin.from("clients").select("id", { count: "exact", head: true }).gte("created_at", twoWeeksAgo).lt("created_at", weekAgo),
    // Candidates this week
    admin.from("candidates").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    // Candidates last week
    admin.from("candidates").select("id", { count: "exact", head: true }).gte("created_at", twoWeeksAgo).lt("created_at", weekAgo),
    // Candidates this month
    admin.from("candidates").select("id", { count: "exact", head: true }).gte("created_at", monthStart),
    // Identity: lockouts
    admin.from("candidates").select("id", { count: "exact", head: true }).gt("test_lockout_until", now.toISOString()),
    // Identity: flagged (Hold)
    admin.from("candidates").select("id", { count: "exact", head: true }).eq("screening_tag", "Hold"),
    // Identity: verified
    admin.from("candidates").select("id", { count: "exact", head: true }).eq("id_verification_status", "passed"),
    // Active conversations
    admin.from("messages").select("thread_id").gte("created_at", weekAgo).limit(500),
    // Talent specialists (for route modal + recruiter alerts)
    admin.from("profiles").select("id, full_name, email, role, recruiter_photo_url").in("role", ["recruiter", "recruiting_manager"]).order("full_name"),
    // Route candidates (assignment_pending_review)
    admin.from("candidates").select("id, full_name, display_name, role_category, country, hourly_rate, created_at").eq("assignment_pending_review", true).limit(20),
    // Bans a specialist has requested and an admin has not yet ruled on. The
    // rail counts these because the page is the only place they surface.
    admin.from("candidates").select("id", { count: "exact", head: true }).eq("ban_pending_review", true),
  ]);

  // Every figure on this dashboard used to arrive through `count || 0`, which
  // cannot tell a failed read from a true zero — so a database hiccup rendered
  // as "0 live candidates · $0 MRR", stated with the same confidence as a real
  // measurement. A figure is now `number | null`, and `figure()` also leaves
  // the label behind so the page can NAME what it could not read: a null says
  // "unknown", `failedReads` says why the lists below may be short.
  const failed = new FailedReads();
  const figure = (label: string, res: { count: number | null; error: unknown }): number | null => {
    const n = countOrNull(res);
    if (n === null) failed.note(label);
    return n;
  };

  const liveCandidates = figure("live candidates", liveCandidatesRes);
  const totalCandidates = figure("candidate total", totalCandidatesRes);
  const activeEngagements = figure("active engagements", activeEngRes);
  // No rows read is not "$0 of fees".
  const mrr: number | null = activeEngDataRes.error || !activeEngDataRes.data
    ? (failed.note("platform fees"), null)
    : activeEngDataRes.data.reduce((s, e) => s + (Number(e.platform_fee_usd) || 0), 0);
  const newEngThisWeek = figure("new engagements this week", newEngThisWeekRes);
  const pendingProfileReview = figure("profile reviews", pendingProfileReviewRes);

  // Pipeline
  const pipeline = {
    applied: totalCandidates,
    englishPass: figure("English passes", englishPassRes),
    idVerified: figure("ID verifications", idVerifiedRes),
    profileBuilt: figure("profiles built", profileBuiltRes),
    aiInterview: figure("interviews completed", aiInterviewRes),
    pendingProfileReview,
    live: liveCandidates,
  };

  // Platform fee this month from active engagements
  const platformFeeThisMonth = mrr === null ? null : Math.round(mrr);

  // ═══ WARM LEADS — clients who browsed but never hired ═══
  const [clientsDataRes, profileViewsRes, allEngRes] = await Promise.all([
    admin.from("clients").select("id, user_id, full_name, company_name, created_at").order("created_at", { ascending: false }),
    admin.from("profile_views").select("client_id, candidate_id, created_at").gte("created_at", twoWeeksAgo),
    admin.from("engagements").select("client_id, status, platform_fee_usd"),
  ]);

  const clients = failed.rows("clients", clientsDataRes);
  const allEng = failed.rows("engagements", allEngRes);

  // Build client engagement map
  const clientEngMap = new Map<string, { active: number; totalFees: number }>();
  for (const e of allEng) {
    if (!clientEngMap.has(e.client_id)) clientEngMap.set(e.client_id, { active: 0, totalFees: 0 });
    const entry = clientEngMap.get(e.client_id)!;
    if (e.status === "active") entry.active++;
    entry.totalFees += Number(e.platform_fee_usd) || 0;
  }

  // Profile views per client
  const clientViewMap = new Map<string, number>();
  for (const v of failed.rows("profile views", profileViewsRes)) {
    clientViewMap.set(v.client_id, (clientViewMap.get(v.client_id) || 0) + 1);
  }

  // Get client last login from profiles
  const clientUserIds = clients.map((c) => c.user_id).filter(Boolean);
  const clientProfilesRes = await admin
    .from("profiles")
    .select("id, updated_at")
    .in("id", clientUserIds.length > 0 ? clientUserIds : ["__none__"]);

  const profileMap = new Map<string, string>();
  for (const p of failed.rows("client last sign-ins", clientProfilesRes)) profileMap.set(p.id, p.updated_at);

  // Build warm leads and client health
  const warmLeads: Array<{
    id: string;
    name: string;
    activity: string;
    daysCold: number;
    isNew: boolean;
  }> = [];

  const clientHealth: Array<{
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
  }> = [];

  for (const c of clients) {
    const eng = clientEngMap.get(c.id) || { active: 0, totalFees: 0 };
    const lastLogin = profileMap.get(c.user_id) || c.created_at;
    const daysSinceLogin = Math.floor((now.getTime() - new Date(lastLogin).getTime()) / (1000 * 60 * 60 * 24));
    const viewCount = clientViewMap.get(c.id) || 0;
    const daysSinceCreation = Math.floor((now.getTime() - new Date(c.created_at).getTime()) / (1000 * 60 * 60 * 24));
    const isNew = daysSinceCreation <= 2;

    // Determine status
    const isActive = eng.active > 0 || (daysSinceLogin <= 14 && viewCount > 0);

    clientHealth.push({
      id: c.id,
      name: c.full_name || "Unknown",
      email: c.company_name || "—",
      lastLogin,
      daysSinceLogin,
      browseActivity: viewCount > 0 ? `Viewed ${viewCount} profile${viewCount > 1 ? "s" : ""}` : "No browse yet",
      activeEngagements: eng.active,
      totalFees: Math.round(eng.totalFees),
      joined: c.created_at,
      status: isActive ? "active" : "inactive",
    });

    // Warm lead criteria: has logged in OR browsed, has zero active engagements, last activity 7+ days ago
    if (eng.active === 0 && (daysSinceLogin >= 7 || isNew)) {
      warmLeads.push({
        id: c.id,
        name: c.full_name || "Unknown",
        activity: viewCount > 0 ? `Viewed ${viewCount} profiles` : isNew ? "Joined recently, no browse" : "No browse activity",
        daysCold: isNew ? 0 : daysSinceLogin,
        isNew,
      });
    }
  }

  // ═══ RECRUITER ALERTS ═══
  const recruiters = failed.rows("talent specialists", talentSpecialistsRes);

  // ═══ PENDING PROFILE REVIEW CANDIDATES (for Review Modal — step 10) ═══
  const pendingCandidatesRes = await admin
    .from("candidates")
    .select("id, full_name, display_name, role_category, country, hourly_rate, english_written_tier, english_mc_score, english_comprehension_score, ai_interview_score, years_experience, voice_recording_1_url, voice_recording_2_url, id_verification_status, profile_photo_url")
    .in("admin_status", ["pending_review", "profile_review"])
    .order("created_at", { ascending: true })
    .limit(20);
  const pendingCandidates = failed.rows("candidates awaiting review", pendingCandidatesRes);

  // ═══ SCREENING STATS ═══
  // `head: true` means the rows never come back — only the count does. Reading
  // `.data.length` off it (what this did) is always 0, so "screened today" has
  // been reporting zero since the widget shipped.
  const screenedTodayCount = figure("screened today", await admin
    .from("screening_log")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()));

  // ═══ MRR SPARKLINE — approximate weekly revenue for last 8 weeks ═══
  const sparkline: number[] = [];
  for (let w = 7; w >= 0; w--) {
    const start = new Date(now.getTime() - (w + 1) * 7 * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000).toISOString();
    const weekEngRes = await admin
      .from("engagements")
      .select("platform_fee_usd")
      .eq("status", "active")
      .lte("created_at", end);
    const weekMrr = failed.rows("revenue history", weekEngRes).reduce((s, e) => s + (Number(e.platform_fee_usd) || 0), 0);
    sparkline.push(Math.round(weekMrr));
  }

  // ═══ TALENT POOL HEALTH ═══
  const roleDataRes = await admin
    .from("candidates")
    .select("role_category, admin_status");
  const roleDataRead = !roleDataRes.error && roleDataRes.data !== null;

  const roleStats = new Map<string, { live: number; pending: number }>();
  for (const c of failed.rows("role depth", roleDataRes)) {
    const role = c.role_category || "Unknown";
    if (!roleStats.has(role)) roleStats.set(role, { live: 0, pending: 0 });
    const entry = roleStats.get(role)!;
    if (isLive(c.admin_status)) entry.live++;
    else if (c.admin_status !== "deactivated" && c.admin_status !== "rejected") entry.pending++;
  }
  let rolesBelow2 = 0;
  for (const [, stats] of roleStats) {
    if (stats.live > 0 && stats.pending / stats.live < 2) rolesBelow2++;
  }

  // Active conversations count
  const activeConversations: number | null = threadDataRes.error || !threadDataRes.data
    ? (failed.note("active conversations"), null)
    : new Set(threadDataRes.data.map((m) => m.thread_id)).size;

  // Applications trend. With one week unread the old arithmetic did not fail —
  // it reported "+100%" or "−100%" depending on which week came back as zero.
  const candidatesThisWeek = figure("applications this week", candidatesThisWeekRes);
  const candidatesLastWeek = figure("applications last week", candidatesLastWeekRes);
  const appChangePercent = changePercentOrNull(candidatesThisWeek, candidatesLastWeek);

  const clientsThisWeek = figure("clients this week", clientsThisWeekRes);
  const clientsLastWeek = figure("clients last week", clientsLastWeekRes);
  const clientWeekChange = changePercentOrNull(clientsThisWeek, clientsLastWeek);

  // Read once, used in three places below.
  const triage = figure("routing decisions", triageRes);
  const clientsTotal = figure("client total", clientsTotalRes);
  // A list built from reads that failed is not a short list.
  const clientListsRead = !clientsDataRes.error && !allEngRes.error;

  const payload = {
    // Score band
    mrr: mrr === null ? null : Math.round(mrr),
    mrrSparkline: sparkline,
    liveCandidates,
    activeEngagements,
    newEngThisWeek,
    platformFeeThisMonth,
    warmLeadsCount: clientListsRead ? warmLeads.length : null,

    // Pipeline
    pipeline,

    // Action cards
    pendingCandidates,
    warmLeads: warmLeads.slice(0, 20),
    recruiterAlerts: {
      needsRouting: triage,
    },

    // Screening. `pending`/`processing`/`failed` used to ship as hard-coded
    // zeroes and `complete` as the total candidate count under a label that
    // did not mean that — the dashboard rendered all four as if they were
    // measurements. Only the real number is returned now; anything that wants
    // queue depth should read ScreeningQueueWidget's own endpoint.
    screening: {
      screenedToday: screenedTodayCount,
    },

    // Identity. `dupesWeek` used to be returned as a hard zero with a comment
    // saying there is no duplicate-detection table — a rendered metric that
    // could only ever say "0 duplicates". Dropped rather than displayed.
    identity: {
      lockouts: figure("test lockouts", lockoutsRes),
      flagged: figure("screening holds", flaggedRes),
      verified: figure("verified identities", verifiedRes),
    },

    // Platform pulse
    pulse: {
      applicationsThisWeek: candidatesThisWeek,
      applicationsLastWeek: candidatesLastWeek,
      appChangePercent,
      clientsThisWeek,
      clientsLastWeek,
      clientWeekChange,
      activeConversations,
      newCandidatesMonth: figure("new candidates this month", candidatesThisMonthRes),
    },

    // Client health
    clientHealth: clientHealth.sort((a, b) => b.totalFees - a.totalFees).slice(0, 25),
    clientsThisMonth: figure("clients this month", clientsThisMonthRes),
    totalClients: clientsTotal,
    talentPoolHealth: { liveCandidates, rolesBelow2: roleDataRead ? rolesBelow2 : null },

    // Sidebar badges
    badges: {
        pendingProfileReview,
      pendingReview: figure("pending reviews", pendingReviewRes),
      clients: clientsTotal,
      talentPool: totalCandidates,
      triage,
      teamInbox: activeConversations,
      pendingBans: figure("ban requests", pendingBansRes),
    },

    // Route candidates
    routeCandidates: failed.rows("candidates to route", routeCandidatesRes),
    recruiters: recruiters.map((r) => ({ id: r.id, name: r.full_name })),
    // Last: it has to see every label the reads above left behind.
    failedReads: failed.labels,
  } satisfies DashboardData;

  return NextResponse.json(payload);
}
