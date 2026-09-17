import { NextResponse } from "next/server";
import { FailedReads, changePercentOrNull, countOrNull } from "@/lib/readCount";
import { LIVE_STATUS, LIVE_STATUSES, isLive } from "@/lib/candidateStatus";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function weekBoundary(weeksAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - weeksAgo * 7);
  // Snap to start of that week (Monday)
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
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
  const lastWeekStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // Parallel fetches
  const [
    liveCandidatesRes,
    activeEngRes,
    activeEngDataRes,
    candidatesThisWeekRes,
    candidatesLastWeekRes,
    candidatesThisMonthRes,
    clientsThisWeekRes,
    clientsThisMonthRes,
    threadDataRes,
    pendingReviewsRes,
    activeDisputesRes,
    banPendingRes,
    disputesPast48Res,
    webhookFailuresRes,
    manualReviewRes,
    screeningFailsRes,
    stalledRevisionsRes,
    payoutNotSetupRes,
    clientsRes,
    profileViewsRes,
    talentSpecialistsRes,
    // Sparkline: approved counts at end of each of past 4 weeks
    // We'll calculate these from candidates with created_at snapshots
  ] = await Promise.all([
    admin.from("candidates").select("id", { count: "exact", head: true }).in("admin_status", LIVE_STATUSES),
    admin.from("engagements").select("id", { count: "exact", head: true }).eq("status", "active"),
    admin.from("engagements").select("platform_fee_usd").eq("status", "active"),
    admin.from("candidates").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    admin.from("candidates").select("id", { count: "exact", head: true }).gte("created_at", lastWeekStart).lt("created_at", weekAgo),
    admin.from("candidates").select("id", { count: "exact", head: true }).gte("created_at", monthAgo),
    admin.from("clients").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    admin.from("clients").select("id", { count: "exact", head: true }).gte("created_at", monthAgo),
    admin.from("messages").select("thread_id").limit(500),
    admin.from("candidates").select("id", { count: "exact", head: true }).in("admin_status", ["active", "profile_review"]),
    admin.from("disputes").select("id", { count: "exact", head: true }).is("resolved_at", null),
    // Alerts
    admin.from("candidates").select("id", { count: "exact", head: true }).eq("ban_pending_review", true),
    admin.from("disputes").select("id", { count: "exact", head: true }).is("resolved_at", null).lt("created_at", new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()),
    admin.from("webhook_failures").select("id, event_type, error_message, created_at", { count: "exact" }).eq("resolved", false),
    admin.from("candidates").select("id", { count: "exact", head: true }).eq("id_verification_status", "manual_review"),
    admin.from("screening_log").select("id", { count: "exact", head: true }).is("tag", null).lt("created_at", new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()),
    admin.from("profile_revisions").select("id", { count: "exact", head: true }).eq("status", "pending").lt("created_at", new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString()),
    // Approved candidates with no payout setup for >48h
    admin.from("candidates").select("id", { count: "exact", head: true }).in("admin_status", LIVE_STATUSES).eq("payout_status", "not_setup").lt("profile_went_live_at", new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()),
    // Client health
    admin.from("clients").select("id, user_id, full_name, company_name, created_at").order("created_at", { ascending: false }),
    // Profile views (last 14 days for "browsed not hired")
    admin.from("profile_views").select("client_id").gte("created_at", twoWeeksAgo),
    // Talent specialist cards
    admin.from("profiles").select("id, full_name, email, role, recruiter_photo_url").in("role", ["recruiter", "recruiting_manager"]).order("full_name"),
    // Calendar link alerts (unacknowledged)
  ]);

  // Same rule as the command centre: a figure is `number | null`, and every
  // null leaves its label in `failedReads`. Nothing in this codebase reads this
  // endpoint any more, which is exactly why its zeros matter — whatever does
  // read it (a monitor, a script) has no page around it to look wrong.
  const failed = new FailedReads();
  const figure = (label: string, res: { count: number | null; error: unknown }): number | null => {
    const n = countOrNull(res);
    if (n === null) failed.note(label);
    return n;
  };

  const liveCandidates = figure("live candidates", liveCandidatesRes);
  const activeEngagements = figure("active eng", activeEngRes);
  const mrr: number | null = activeEngDataRes.error || !activeEngDataRes.data
    ? (failed.note("platform fees"), null)
    : activeEngDataRes.data.reduce((s, e) => s + (Number(e.platform_fee_usd) || 0), 0);
  const candidatesThisWeek = figure("candidates this week", candidatesThisWeekRes);
  const candidatesLastWeek = figure("candidates last week", candidatesLastWeekRes);
  const candidatesThisMonth = figure("candidates this month", candidatesThisMonthRes);
  const clientsThisWeek = figure("clients this week", clientsThisWeekRes);
  const clientsThisMonth = figure("clients this month", clientsThisMonthRes);
  const uniqueThreads: number | null = threadDataRes.error || !threadDataRes.data
    ? (failed.note("active conversations"), null)
    : new Set(threadDataRes.data.map((m) => m.thread_id)).size;
  const pendingReviews = figure("pending reviews", pendingReviewsRes);
  const activeDisputes = figure("active disputes", activeDisputesRes);

  // Applications week-over-week
  const appChangePercent = changePercentOrNull(candidatesThisWeek, candidatesLastWeek);

  // Browsed not hired: clients who viewed profiles but have zero active engagements
  const viewingClientIds = new Set((profileViewsRes.data || []).map((v) => v.client_id));

  // Get engagements per client
  const { data: engByClient } = await admin
    .from("engagements")
    .select("client_id")
    .eq("status", "active");
  const clientsWithEngagements = new Set((engByClient || []).map((e) => e.client_id));
  const browsedNotHired = [...viewingClientIds].filter((id) => !clientsWithEngagements.has(id)).length;

  // Client health table
  const clients = clientsRes.data || [];
  // Get last login from profiles
  const clientUserIds = clients.map((c) => c.user_id);
  const { data: clientProfiles } = await admin
    .from("profiles")
    .select("id, updated_at")
    .in("id", clientUserIds.length > 0 ? clientUserIds : ["__none__"]);

  const profileMap = new Map<string, string>();
  for (const p of clientProfiles || []) profileMap.set(p.id, p.updated_at);

  // Get engagement counts and fees per client
  const { data: allEng } = await admin
    .from("engagements")
    .select("client_id, status, platform_fee_usd");

  const clientEngMap = new Map<string, { active: number; totalFees: number }>();
  for (const e of allEng || []) {
    if (!clientEngMap.has(e.client_id)) clientEngMap.set(e.client_id, { active: 0, totalFees: 0 });
    const entry = clientEngMap.get(e.client_id)!;
    if (e.status === "active") entry.active++;
    entry.totalFees += Number(e.platform_fee_usd) || 0;
  }

  const clientHealth = clients.map((c) => {
    const lastLogin = profileMap.get(c.user_id) || c.created_at;
    const eng = clientEngMap.get(c.id) || { active: 0, totalFees: 0 };
    const lastLoginDate = new Date(lastLogin);
    const daysSinceLogin = Math.floor((now.getTime() - lastLoginDate.getTime()) / (1000 * 60 * 60 * 24));
    const churningRisk = eng.active > 0 && daysSinceLogin > 14;

    return {
      id: c.id,
      name: c.full_name,
      company: c.company_name,
      lastLogin,
      daysSinceLogin,
      activeEngagements: eng.active,
      totalFees: Math.round(eng.totalFees),
      createdAt: c.created_at,
      churningRisk,
    };
  }).sort((a, b) => b.totalFees - a.totalFees);

  // Sparkline data: approximate weekly snapshots
  // For candidates live sparkline: count approved candidates created before each week boundary
  const sparklineWeeks = [0, 1, 2, 3].map((w) => weekBoundary(w));
  const liveSpark: (number | null)[] = [];
  for (const boundary of sparklineWeeks) {
    // A point that could not be read is a gap in the line (null), not a dip to zero.
    liveSpark.push(figure("live candidates history", await admin
      .from("candidates")
      .select("id", { count: "exact", head: true })
      .in("admin_status", LIVE_STATUSES)
      .lte("updated_at", boundary)));
  }
  // Current value is the first, then historical
  liveSpark[0] = liveCandidates;
  liveSpark.reverse(); // oldest first for sparkline

  // Alerts
  const alerts = {
    banPending: figure("ban pending", banPendingRes),
    disputesPast48h: figure("disputes past48h", disputesPast48Res),
    webhookFailures: figure("webhook failures", webhookFailuresRes),
    webhookFailuresList: (webhookFailuresRes.data || []).slice(0, 5),
    manualReview: figure("manual review", manualReviewRes),
    screeningFails: figure("screening fails", screeningFailsRes),
    stalledRevisions: figure("stalled revisions", stalledRevisionsRes),
    payoutNotSetup: figure("payout not setup", payoutNotSetupRes),
  };

  // Talent pool summary for link card
  const { data: lowPipelineRoles } = await admin
    .from("candidates")
    .select("role_category, admin_status");

  const roleStats = new Map<string, { live: number; pending: number }>();
  for (const c of lowPipelineRoles || []) {
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

  return NextResponse.json({
    // Original metrics (backwards compat)
    liveCandidates,
    activeEngagements,
    mrr: mrr === null ? null : Math.round(mrr),
    candidatesThisWeek,
    candidatesThisMonth,
    clientsThisWeek,
    clientsThisMonth,
    totalThreads: uniqueThreads,
    pendingReviews,
    activeDisputes,
    // New: leading indicators
    appChangePercent,
    candidatesLastWeek,
    browsedNotHired,
    // New: sparklines
    sparklines: {
      liveCandidates: liveSpark,
    },
    // New: alerts
    alerts,
    // New: client health
    clientHealth,
    // New: talent pool summary
    talentPool: {
      liveCandidates,
      rolesBelow2,
    },
    // Talent specialist cards
    talentSpecialists: failed.rows("talent specialists", talentSpecialistsRes),
    // Every read above that failed, by name. A null figure says "unknown";
    // this says which, in one place, for a caller that checks nothing else.
    failedReads: failed.labels,
  });
}
