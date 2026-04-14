import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getManagerUser(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ).auth.getUser(token);
  if (!user) return null;
  const supabase = getAdminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, calendar_link, daily_interview_target, recruiter_type")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "recruiting_manager") return null;
  return { user, profile };
}

export async function GET(req: NextRequest) {
  const auth = await getManagerUser(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { user, profile } = auth;
  const supabase = getAdminClient();
  const today = new Date().toISOString().split("T")[0];
  const todayStart = `${today}T00:00:00.000Z`;
  const todayEnd = `${today}T23:59:59.999Z`;

  // Week boundaries for metrics
  const now = new Date();
  const dayOfWeek = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  weekStart.setHours(0, 0, 0, 0);
  const weekStartISO = weekStart.toISOString();

  const [
    // Personal KPI
    myInterviewsRes,
    mySocialRes,
    // Team data
    allRecruitersRes,
    allSocialTodayRes,
    // Unrouted queue
    unroutedRes,
    // Manager notifications
    notificationsRes,
    // Unrouted alerts
    unroutedAlertsRes,
    // Recent go-lives
    recentGoLivesRes,
    // Ban requests
    banRes,
    // Stalled revisions (>72h)
    stalledRes,
    // All team interviews today
    teamInterviewsRes,
    // Social posts this week (for compliance grid)
    weeklyPostsRes,
    // Revision item aggregation
    allRevisionsRes,
    // Candidates for pipeline velocity
    approvedThisWeekRes,
    // Calendar link alerts (unacknowledged)
    calendarAlertsRes,
  ] = await Promise.all([
    // My interviews today
    supabase
      .from("candidates")
      .select("id", { count: "exact", head: true })
      .eq("assigned_recruiter", user.id)
      .eq("second_interview_status", "completed")
      .gte("second_interview_completed_at", todayStart)
      .lte("second_interview_completed_at", todayEnd),
    // My social posts
    supabase
      .from("social_posts")
      .select("id, post_url, created_at")
      .eq("recruiter_id", user.id)
      .eq("post_date", today),
    // All recruiters
    supabase
      .from("profiles")
      .select("id, full_name, role, calendar_link, daily_interview_target, recruiter_type")
      .in("role", ["recruiter", "recruiting_manager"])
      .order("full_name"),
    // All social posts today
    supabase
      .from("social_posts")
      .select("recruiter_id, post_url")
      .eq("post_date", today),
    // Unrouted candidates
    supabase
      .from("candidates")
      .select("id, display_name, full_name, role_category, role_category_custom, profile_photo_url, screening_score, english_mc_score, created_at, english_written_tier")
      .eq("role_category", "Other")
      .is("assigned_recruiter", null)
      .order("created_at", { ascending: true }),
    // Manager notifications (unread)
    supabase
      .from("manager_notifications")
      .select("id, message, candidate_id, recruiter_id, created_at, read_at")
      .eq("manager_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    // Unrouted alerts (unresolved)
    supabase
      .from("unrouted_alerts")
      .select("id, candidate_id, ai_interview_result, created_at, resolved_at")
      .is("resolved_at", null)
      .order("created_at", { ascending: true }),
    // Recent go-lives
    supabase
      .from("candidates")
      .select("id, display_name, full_name, role_category, profile_photo_url, profile_went_live_at, assigned_recruiter")
      .eq("admin_status", "approved")
      .not("profile_went_live_at", "is", null)
      .order("profile_went_live_at", { ascending: false })
      .limit(10),
    // Ban requests
    supabase
      .from("candidates")
      .select("id, display_name, full_name, role_category, ban_reason, ban_requested_by, ban_requested_at, ban_pending_review")
      .eq("ban_pending_review", true),
    // Stalled revisions (>72h)
    supabase
      .from("profile_revisions")
      .select("id, candidate_id, items, status, created_at, candidates!inner(id, display_name, full_name, role_category, profile_photo_url, assigned_recruiter)")
      .eq("status", "pending")
      .lt("created_at", new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()),
    // All team interviews today
    supabase
      .from("candidates")
      .select("assigned_recruiter", { count: "exact" })
      .eq("second_interview_status", "completed")
      .gte("second_interview_completed_at", todayStart)
      .lte("second_interview_completed_at", todayEnd),
    // Weekly social posts (for compliance grid)
    supabase
      .from("social_posts")
      .select("recruiter_id, post_date, post_url")
      .gte("post_date", weekStart.toISOString().split("T")[0]),
    // All revisions for top items analysis
    supabase
      .from("profile_revisions")
      .select("items, created_at")
      .gte("created_at", weekStartISO),
    // Approved this week
    supabase
      .from("candidates")
      .select("id", { count: "exact", head: true })
      .eq("admin_status", "approved")
      .gte("updated_at", weekStartISO),
    // Calendar link alerts (unacknowledged)
    supabase
      .from("calendar_link_alerts")
      .select("id, recruiter_id, recruiter_name, alerted_at")
      .eq("acknowledged", false)
      .order("alerted_at", { ascending: false }),
  ]);

  // Process team status
  const recruiters = allRecruitersRes.data || [];
  const socialToday = allSocialTodayRes.data || [];
  const socialByRecruiter = new Map<string, number>();
  for (const p of socialToday) {
    socialByRecruiter.set(p.recruiter_id, (socialByRecruiter.get(p.recruiter_id) || 0) + 1);
  }

  // Count interviews per recruiter today
  const teamInterviews = teamInterviewsRes.data || [];
  const interviewsByRecruiter = new Map<string, number>();
  for (const c of teamInterviews) {
    if (c.assigned_recruiter) {
      interviewsByRecruiter.set(c.assigned_recruiter, (interviewsByRecruiter.get(c.assigned_recruiter) || 0) + 1);
    }
  }

  // Get queue depth per recruiter
  const { data: queueCounts } = await supabase
    .from("candidates")
    .select("assigned_recruiter")
    .not("assigned_recruiter", "is", null)
    .not("admin_status", "in", '("approved","deactivated","rejected")');

  const queueByRecruiter = new Map<string, number>();
  for (const c of queueCounts || []) {
    if (c.assigned_recruiter) {
      queueByRecruiter.set(c.assigned_recruiter, (queueByRecruiter.get(c.assigned_recruiter) || 0) + 1);
    }
  }

  const teamStatus = recruiters.map((r) => ({
    id: r.id,
    name: r.full_name,
    role: r.role,
    interviewsToday: interviewsByRecruiter.get(r.id) || 0,
    dailyTarget: r.daily_interview_target,
    socialPostsToday: socialByRecruiter.get(r.id) || 0,
    queueDepth: queueByRecruiter.get(r.id) || 0,
    calendarLink: r.calendar_link,
    calendarValid: !!r.calendar_link,
  }));

  // Team totals
  const totalTeamTarget = recruiters.reduce((s, r) => s + (r.daily_interview_target || 0), 0);
  const totalTeamInterviews = teamInterviews.length;
  const recruitersAt2Posts = recruiters.filter((r) => (socialByRecruiter.get(r.id) || 0) >= 2).length;

  // Recruiter name map for enrichment
  const recruiterNameMap = new Map<string, string>();
  for (const r of recruiters) recruiterNameMap.set(r.id, r.full_name);

  // Manar's personal TS queue — candidates assigned to this manager
  const { data: myQueue, error: myQueueError } = await supabase
    .from("candidates")
    .select("id, display_name, role_category, admin_status, screening_tag, country, updated_at, created_at")
    .eq("assigned_recruiter", user.id)
    .not("admin_status", "in", '("rejected","deactivated")')
    .order("updated_at", { ascending: false })
    .limit(100);

  // All candidates with assignment info (for manager assignment table)
  const { data: allCandidatesRaw, error: allCandidatesError } = await supabase
    .from("candidates")
    .select("id, display_name, role_category, admin_status, screening_tag, country, updated_at, created_at, assigned_recruiter")
    .not("admin_status", "in", '("rejected","deactivated")')
    .order("created_at", { ascending: false })
    .limit(100);

  console.log("[MANAGER DASH] myQueue:", myQueue?.length, "myQueueError:", JSON.stringify(myQueueError), "allCandidatesRaw:", allCandidatesRaw?.length, "allCandidatesError:", JSON.stringify(allCandidatesError), "user.id:", user.id);

  // Enrich allCandidates with recruiter names
  const allCandidates = (allCandidatesRaw || []).map((c) => ({
    ...c,
    assigned_recruiter_name: c.assigned_recruiter
      ? recruiterNameMap.get(c.assigned_recruiter) || "Unknown"
      : "Unassigned",
  }));

  // Enrich unrouted alerts with candidate info
  const unroutedAlerts = unroutedAlertsRes.data || [];
  // Fetch candidate details for alerts
  const alertCandidateIds = unroutedAlerts.map((a: { candidate_id: string }) => a.candidate_id);
  let alertCandidates: Record<string, { display_name: string; full_name: string; role_category_custom: string | null }> = {};
  if (alertCandidateIds.length > 0) {
    const { data: alertCandidateData } = await supabase
      .from("candidates")
      .select("id, display_name, full_name, role_category_custom")
      .in("id", alertCandidateIds);
    if (alertCandidateData) {
      for (const c of alertCandidateData) {
        alertCandidates[c.id] = { display_name: c.display_name, full_name: c.full_name, role_category_custom: c.role_category_custom };
      }
    }
  }

  const enrichedAlerts = unroutedAlerts.map((a: { id: string; candidate_id: string; ai_interview_result: boolean; created_at: string }) => ({
    ...a,
    candidate_name: alertCandidates[a.candidate_id]?.display_name || alertCandidates[a.candidate_id]?.full_name || "Unknown",
    role_category_custom: alertCandidates[a.candidate_id]?.role_category_custom || null,
  }));

  // Enrich recent go-lives with recruiter names
  const recentGoLives = (recentGoLivesRes.data || []).map((c: { id: string; display_name: string; full_name: string; role_category: string; profile_photo_url: string | null; profile_went_live_at: string; assigned_recruiter: string | null }) => ({
    ...c,
    recruiter_name: c.assigned_recruiter ? recruiterNameMap.get(c.assigned_recruiter) || "Unknown" : "Unassigned",
  }));

  // Ban requests enrichment
  const banQueue = (banRes.data || []).map((c) => ({
    ...c,
    ban_requested_by_name: c.ban_requested_by ? recruiterNameMap.get(c.ban_requested_by) || "Unknown" : "Unknown",
  }));

  // Pipeline velocity: top revision items
  const revisionItemCounts = new Map<string, number>();
  for (const rev of allRevisionsRes.data || []) {
    for (const item of (rev.items as { type: string }[])) {
      const shortType = item.type.split(" — ")[0];
      revisionItemCounts.set(shortType, (revisionItemCounts.get(shortType) || 0) + 1);
    }
  }
  const topRevisionItems = Array.from(revisionItemCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => ({ type, count }));

  // Weekly posting compliance grid
  const weeklyPosts = weeklyPostsRes.data || [];
  const postingGrid = new Map<string, Map<string, number>>();
  for (const p of weeklyPosts) {
    if (!postingGrid.has(p.recruiter_id)) postingGrid.set(p.recruiter_id, new Map());
    const dayMap = postingGrid.get(p.recruiter_id)!;
    dayMap.set(p.post_date, (dayMap.get(p.post_date) || 0) + 1);
  }

  // Build grid rows
  const gridDays: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    gridDays.push(d.toISOString().split("T")[0]);
  }

  const complianceGrid = recruiters.map((r) => {
    const dayMap = postingGrid.get(r.id) || new Map();
    return {
      recruiterId: r.id,
      recruiterName: r.full_name,
      days: gridDays.map((day) => ({ date: day, count: dayMap.get(day) || 0 })),
    };
  });

  return NextResponse.json({
    personalKpi: {
      interviewsToday: myInterviewsRes.count ?? 0,
      dailyTarget: profile.daily_interview_target,
      recruiterType: profile.recruiter_type,
      socialPosts: mySocialRes.data || [],
      calendarLink: profile.calendar_link || null,
      calendarValid: !!profile.calendar_link,
    },
    teamSummary: {
      totalInterviewsToday: totalTeamInterviews,
      totalTarget: totalTeamTarget,
      postingCompliance: { at2Posts: recruitersAt2Posts, totalRecruiters: recruiters.length },
      unroutedAlertCount: enrichedAlerts.length,
    },
    teamStatus,
    unroutedQueue: unroutedRes.data || [],
    unroutedAlerts: enrichedAlerts,
    managerNotifications: notificationsRes.data || [],
    recentGoLives,
    banQueue,
    stalledRevisions: stalledRes.data || [],
    metrics: {
      approvedThisWeek: approvedThisWeekRes.count ?? 0,
      topRevisionItems,
      weeklyPostingCompliance: Math.round((recruitersAt2Posts / Math.max(recruiters.length, 1)) * 100),
    },
    complianceGrid,
    gridDays,
    recruiterNameMap: Object.fromEntries(recruiterNameMap),
    calendarAlerts: calendarAlertsRes.data || [],
    myQueue: myQueue || [],
    allCandidates,
  });
}
