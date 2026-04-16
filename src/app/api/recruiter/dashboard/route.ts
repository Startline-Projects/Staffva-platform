import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getRecruiterUser(req: NextRequest) {
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
    .select("role, calendar_link, daily_interview_target, recruiter_type, google_calendar_connected")
    .eq("id", user.id)
    .single();
  if (!profile || (profile.role !== "recruiter" && profile.role !== "recruiting_manager")) return null;
  return { user, profile };
}

export async function GET(req: NextRequest) {
  const auth = await getRecruiterUser(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { user, profile } = auth;
  console.log(`[RECRUITER DASHBOARD] user.id: ${user.id}, profile.role: ${profile.role}`);
  const supabase = getAdminClient();
  const today = new Date().toISOString().split("T")[0];
  const todayStart = `${today}T00:00:00.000Z`;
  const todayEnd = `${today}T23:59:59.999Z`;

  const recruiterId = user.id.toString();

  // Step 1: Get all assigned candidates (name+photo for candidateMap, IDs for Lane 3 filter)
  const { data: assignedCandidates } = await supabase
    .from("candidates")
    .select("id, display_name, full_name, profile_photo_url")
    .eq("assigned_recruiter", recruiterId);
  const assignedCandidateIds = (assignedCandidates || []).map((c: { id: string }) => c.id);

  // Parallel fetches
  const [
    interviewsRes,
    socialRes,
    queueRes,
    lane1Res,
    lane2Res,
    lane3Res,
    threadsRes,
    pipelineRes,
    upcomingRes,
    unmatchedRes,
  ] = await Promise.all([
    // KPI: completed interviews today for this recruiter
    supabase
      .from("candidates")
      .select("id", { count: "exact", head: true })
      .eq("assigned_recruiter", recruiterId)
      .eq("second_interview_status", "completed")
      .gte("second_interview_completed_at", todayStart)
      .lte("second_interview_completed_at", todayEnd),

    // KPI: social posts today
    supabase
      .from("social_posts")
      .select("id, post_url, created_at")
      .eq("recruiter_id", recruiterId)
      .eq("post_date", today)
      .order("created_at", { ascending: true }),

    // Queue: assigned candidates who completed AI interview but haven't been scheduled yet
    supabase
      .from("candidates")
      .select("id, display_name, full_name, role_category, profile_photo_url, ai_interview_completed_at, email")
      .eq("assigned_recruiter", recruiterId)
      .not("ai_interview_completed_at", "is", null)
      .eq("second_interview_status", "none")
      .not("admin_status", "eq", "approved")
      .not("admin_status", "eq", "deactivated")
      .order("ai_interview_completed_at", { ascending: true }),

    // Lane 1: Resumes to review — interviews scheduled today or upcoming
    supabase
      .from("candidates")
      .select("id, display_name, full_name, role_category, profile_photo_url, second_interview_scheduled_at, screening_score, resume_url, recruiter_ai_score_results")
      .eq("assigned_recruiter", recruiterId)
      .eq("second_interview_status", "scheduled")
      .order("second_interview_scheduled_at", { ascending: true }),

    // Lane 2: Profiles to submit — interview completed, not yet submitted, no pending revision
    supabase
      .from("candidates")
      .select("id, display_name, full_name, role_category, profile_photo_url, screening_score, second_interview_completed_at, admin_status, profile_photo_url, tagline, bio, resume_url, payout_method, id_verification_status, voice_recording_1_url, voice_recording_2_url, english_mc_score, english_comprehension_score, speaking_level, interview_consent_at, recruiter_ai_score_results, video_intro_url, id_verification_consent")
      .eq("assigned_recruiter", recruiterId)
      .eq("second_interview_status", "completed")
      .eq("admin_status", "pending_speaking_review"),

    // Lane 3: Revision follow-ups — pending revisions for assigned candidates
    // Two-step approach: filter by candidate IDs instead of nested join filter
    assignedCandidateIds.length > 0
      ? supabase
          .from("profile_revisions")
          .select("id, candidate_id, items, status, created_at, candidates!inner(id, display_name, full_name, role_category, profile_photo_url, assigned_recruiter)")
          .eq("status", "pending")
          .in("candidate_id", assignedCandidateIds)
      : Promise.resolve({ data: [], error: null }),

    // Message threads
    supabase
      .from("recruiter_messages")
      .select("candidate_id, sender_role, body, created_at, read_at")
      .eq("recruiter_id", recruiterId)
      .order("created_at", { ascending: false })
      .limit(200),

    // Pipeline: every candidate assigned to this recruiter, ordered by candidate creation date
    // (candidates.assigned_at doesn't exist; created_at is the closest stable proxy)
    supabase
      .from("candidates")
      .select("id, display_name, role_category, profile_photo_url, admin_status, second_interview_status, ai_interview_completed_at, ai_interview_score, created_at")
      .eq("assigned_recruiter", recruiterId)
      .order("created_at", { ascending: false }),

    // Upcoming interviews — scheduled via Google Calendar
    supabase
      .from("candidates")
      .select("id, display_name, role_category, profile_photo_url, second_interview_scheduled_at, google_calendar_event_id")
      .eq("assigned_recruiter", recruiterId)
      .eq("second_interview_status", "scheduled")
      .not("second_interview_scheduled_at", "is", null)
      .order("second_interview_scheduled_at", { ascending: true }),

    // Unmatched calendar bookings
    supabase
      .from("calendar_unmatched_bookings")
      .select("id, event_id, event_start, attendee_name, created_at")
      .eq("recruiter_id", recruiterId),
  ]);

  console.log(`[RECRUITER DASHBOARD] recruiterId: ${recruiterId}, assignedTotal: ${assignedCandidateIds.length}, Queue: ${queueRes.data?.length ?? 0}, Lane1: ${lane1Res.data?.length ?? 0}, Lane2: ${lane2Res.data?.length ?? 0}, Lane3: ${lane3Res.data?.length ?? 0}, errors: ${JSON.stringify({ q: queueRes.error?.message, l1: lane1Res.error?.message, l2: lane2Res.error?.message, l3: lane3Res.error?.message })}`);

  // Process interviews count
  const interviewsToday = interviewsRes.count ?? 0;

  // Process social posts
  const socialPosts = socialRes.data || [];

  // Lane 2: filter out candidates with pending revisions
  const lane2Candidates = lane2Res.data || [];
  const lane3Data = lane3Res.data || [];
  const candidatesWithPendingRevisions = new Set(
    lane3Data.map((r: { candidate_id: string }) => r.candidate_id)
  );
  const lane2Filtered = lane2Candidates.filter(
    (c: { id: string }) =>
      !candidatesWithPendingRevisions.has(c.id)
  );

  // Process message threads
  const msgs = threadsRes.data || [];
  const threadMap = new Map<string, { messages: typeof msgs }>();
  for (const m of msgs) {
    if (!threadMap.has(m.candidate_id)) threadMap.set(m.candidate_id, { messages: [] });
    threadMap.get(m.candidate_id)!.messages.push(m);
  }

  const threads = Array.from(threadMap.entries()).map(([candidateId, { messages }]) => {
    const latest = messages[0];
    const unread = messages.filter((m) => m.sender_role === "candidate" && !m.read_at).length;
    return { candidate_id: candidateId, last_message: latest.body, last_message_at: latest.created_at, unread_count: unread };
  }).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

  // Calendar link validation — 3-second timeout to avoid blocking the response
  let calendarValid: boolean | null = null;
  if (profile.calendar_link) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(profile.calendar_link, { method: "HEAD", redirect: "follow", signal: controller.signal });
      clearTimeout(timeout);
      calendarValid = res.ok;
    } catch {
      calendarValid = false;
    }
  }

  return NextResponse.json({
    kpi: {
      interviewsToday,
      dailyTarget: profile.daily_interview_target,
      recruiterType: profile.recruiter_type,
      socialPosts,
      calendarLink: profile.calendar_link || null,
      calendarValid,
    },
    googleConnected: profile.google_calendar_connected ?? false,
    queue: queueRes.data || [],
    allAssigned: assignedCandidates || [],
    lane1: lane1Res.data || [],
    lane2: lane2Filtered,
    lane3: lane3Data,
    pipeline: pipelineRes.data || [],
    upcoming_interviews: upcomingRes.data || [],
    unmatched_bookings: unmatchedRes.data || [],
    threads,
    profile: {
      role: profile.role,
      calendarLink: profile.calendar_link,
    },
  });
}
