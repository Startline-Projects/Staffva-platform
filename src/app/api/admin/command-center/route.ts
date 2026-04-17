import { NextResponse } from "next/server";
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

  if (!user || user.user_metadata?.role !== "admin") {
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
    pending2ndInterviewRes,
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
  ] = await Promise.all([
    // Live candidates
    admin.from("candidates").select("id", { count: "exact", head: true }).eq("admin_status", "approved"),
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
    // Pipeline: Profile built (photo + resume + tagline + bio + payout + consent)
    admin.from("candidates").select("id", { count: "exact", head: true })
      .not("profile_photo_url", "is", null)
      .not("resume_url", "is", null)
      .not("tagline", "is", null)
      .not("bio", "is", null)
      .not("payout_method", "is", null)
      .eq("interview_consent", true),
    // Pipeline: AI interview completed
    admin.from("candidates").select("id", { count: "exact", head: true }).not("ai_interview_completed_at", "is", null),
    // Pipeline: Pending 2nd interview (includes legacy pending_speaking_review and pending_review)
    admin.from("candidates").select("id", { count: "exact", head: true }).in("admin_status", ["pending_speaking_review", "pending_review", "pending_2nd_interview"]),
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
    admin.from("candidates").select("id", { count: "exact", head: true }).gt("anticheat_lockout_until", now.toISOString()),
    // Identity: flagged (Hold)
    admin.from("candidates").select("id", { count: "exact", head: true }).eq("screening_tag", "Hold"),
    // Identity: verified
    admin.from("candidates").select("id", { count: "exact", head: true }).eq("id_verification_status", "passed"),
    // Active conversations
    admin.from("messages").select("thread_id").gte("created_at", weekAgo).limit(500),
    // Talent specialists (for route modal + recruiter alerts)
    admin.from("profiles").select("id, full_name, email, role, avatar_url, calendar_link").in("role", ["recruiter", "recruiting_manager"]).order("full_name"),
    // Route candidates (assignment_pending_review)
    admin.from("candidates").select("id, full_name, display_name, role_category, country, monthly_rate, created_at").eq("assignment_pending_review", true).limit(20),
  ]);

  const liveCandidates = liveCandidatesRes.count || 0;
  const totalCandidates = totalCandidatesRes.count || 0;
  const activeEngagements = activeEngRes.count || 0;
  const mrr = (activeEngDataRes.data || []).reduce((s, e) => s + (Number(e.platform_fee_usd) || 0), 0);
  const newEngThisWeek = newEngThisWeekRes.count || 0;
  const pending2ndInterview = pending2ndInterviewRes.count || 0;

  // Pipeline
  const pipeline = {
    applied: totalCandidates,
    englishPass: englishPassRes.count || 0,
    idVerified: idVerifiedRes.count || 0,
    profileBuilt: profileBuiltRes.count || 0,
    aiInterview: aiInterviewRes.count || 0,
    pending2ndInterview,
    live: liveCandidates,
  };

  // Platform fee this month from active engagements
  const platformFeeThisMonth = Math.round(mrr);

  // ═══ WARM LEADS — clients who browsed but never hired ═══
  const [clientsDataRes, profileViewsRes, allEngRes] = await Promise.all([
    admin.from("clients").select("id, user_id, full_name, company_name, created_at").order("created_at", { ascending: false }),
    admin.from("profile_views").select("client_id, candidate_id, created_at").gte("created_at", twoWeeksAgo),
    admin.from("engagements").select("client_id, status, platform_fee_usd"),
  ]);

  const clients = clientsDataRes.data || [];
  const allEng = allEngRes.data || [];

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
  for (const v of profileViewsRes.data || []) {
    clientViewMap.set(v.client_id, (clientViewMap.get(v.client_id) || 0) + 1);
  }

  // Get client last login from profiles
  const clientUserIds = clients.map((c) => c.user_id).filter(Boolean);
  const { data: clientProfiles } = await admin
    .from("profiles")
    .select("id, updated_at")
    .in("id", clientUserIds.length > 0 ? clientUserIds : ["__none__"]);

  const profileMap = new Map<string, string>();
  for (const p of clientProfiles || []) profileMap.set(p.id, p.updated_at);

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
  const recruiters = talentSpecialistsRes.data || [];
  const missingCalendar = recruiters.filter((r) => !r.calendar_link);

  // Unreviewed candidates per recruiter
  const { data: assignedCandidates } = await admin
    .from("candidates")
    .select("assigned_recruiter, id")
    .is("second_interview_status", null)
    .not("assigned_recruiter", "is", null);

  const recruiterUnreviewed = new Map<string, number>();
  for (const c of assignedCandidates || []) {
    recruiterUnreviewed.set(c.assigned_recruiter, (recruiterUnreviewed.get(c.assigned_recruiter) || 0) + 1);
  }

  const unreviewedByRecruiter = recruiters
    .map((r) => ({ id: r.id, name: r.full_name, count: recruiterUnreviewed.get(r.id) || 0 }))
    .filter((r) => r.count > 10);

  // ═══ PENDING REVIEW CANDIDATES (for Review Modal) ═══
  const { data: pendingCandidates } = await admin
    .from("candidates")
    .select("id, full_name, display_name, role_category, country, monthly_rate, english_tier, english_mc_score, english_comprehension_score, ai_interview_score, years_experience, voice_recording_1_url, voice_recording_2_url, id_verification_status, profile_photo_url")
    .in("admin_status", ["pending_speaking_review", "pending_review", "pending_2nd_interview"])
    .order("created_at", { ascending: true })
    .limit(20);

  // ═══ SCREENING STATS ═══
  const { data: screeningToday } = await admin
    .from("screening_log")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString());

  // ═══ MRR SPARKLINE — approximate weekly revenue for last 8 weeks ═══
  const sparkline: number[] = [];
  for (let w = 7; w >= 0; w--) {
    const start = new Date(now.getTime() - (w + 1) * 7 * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: weekEng } = await admin
      .from("engagements")
      .select("platform_fee_usd")
      .eq("status", "active")
      .lte("created_at", end);
    const weekMrr = (weekEng || []).reduce((s, e) => s + (Number(e.platform_fee_usd) || 0), 0);
    sparkline.push(Math.round(weekMrr));
  }

  // ═══ TALENT POOL HEALTH ═══
  const { data: roleData } = await admin
    .from("candidates")
    .select("role_category, admin_status");

  const roleStats = new Map<string, { live: number; pending: number }>();
  for (const c of roleData || []) {
    const role = c.role_category || "Unknown";
    if (!roleStats.has(role)) roleStats.set(role, { live: 0, pending: 0 });
    const entry = roleStats.get(role)!;
    if (c.admin_status === "approved") entry.live++;
    else if (c.admin_status !== "deactivated" && c.admin_status !== "rejected") entry.pending++;
  }
  let rolesBelow2 = 0;
  for (const [, stats] of roleStats) {
    if (stats.live > 0 && stats.pending / stats.live < 2) rolesBelow2++;
  }

  // Active conversations count
  const activeConversations = new Set((threadDataRes.data || []).map((m) => m.thread_id)).size;

  // Applications trend
  const candidatesThisWeek = candidatesThisWeekRes.count || 0;
  const candidatesLastWeek = candidatesLastWeekRes.count || 0;
  const appChangePercent = candidatesLastWeek > 0
    ? Math.round(((candidatesThisWeek - candidatesLastWeek) / candidatesLastWeek) * 100)
    : candidatesThisWeek > 0 ? 100 : 0;

  const clientsThisWeek = clientsThisWeekRes.count || 0;
  const clientsLastWeek = clientsLastWeekRes.count || 0;
  const clientWeekChange = clientsLastWeek > 0
    ? Math.round(((clientsThisWeek - clientsLastWeek) / clientsLastWeek) * 100)
    : clientsThisWeek > 0 ? 100 : 0;

  return NextResponse.json({
    // Score band
    mrr: Math.round(mrr),
    mrrSparkline: sparkline,
    liveCandidates,
    activeEngagements,
    newEngThisWeek,
    platformFeeThisMonth,
    warmLeadsCount: warmLeads.length,

    // Seminar
    seminarDate: "2026-04-19",

    // Pipeline
    pipeline,

    // Action cards
    pending2ndInterview,
    pendingCandidates: pendingCandidates || [],
    warmLeads: warmLeads.slice(0, 20),
    recruiterAlerts: {
      missingCalendar: missingCalendar.map((r) => ({ id: r.id, name: r.full_name })),
      needsRouting: triageRes.count || 0,
      unreviewedByRecruiter,
    },

    // Screening
    screening: {
      pending: 0, // Will be filled by ScreeningQueueWidget's own API
      processing: 0,
      complete: totalCandidates,
      failed: 0,
      screenedToday: screeningToday?.length || 0,
    },

    // Identity
    identity: {
      lockouts: lockoutsRes.count || 0,
      dupesWeek: 0, // No duplicate detection table yet
      flagged: flaggedRes.count || 0,
      verified: verifiedRes.count || 0,
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
      newCandidatesMonth: candidatesThisMonthRes.count || 0,
    },

    // Client health
    clientHealth: clientHealth.sort((a, b) => b.totalFees - a.totalFees).slice(0, 25),
    clientsThisMonth: clientsThisMonthRes.count || 0,
    totalClients: clientsTotalRes.count || 0,
    talentPoolHealth: { liveCandidates, rolesBelow2 },

    // Sidebar badges
    badges: {
      pending2ndInterview,
      pendingReview: pendingReviewRes.count || 0,
      clients: clientsTotalRes.count || 0,
      talentPool: totalCandidates,
      triage: triageRes.count || 0,
      teamInbox: activeConversations,
    },

    // Route candidates
    routeCandidates: routeCandidatesRes.data || [],
    recruiters: recruiters.map((r) => ({ id: r.id, name: r.full_name })),
  });
}
