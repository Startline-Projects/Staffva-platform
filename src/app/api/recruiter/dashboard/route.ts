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
  // Role lives in user_metadata (same pattern as recruiting-manager/approve)
  const role = user.user_metadata?.role;
  if (!role || !["recruiter", "recruiting_manager"].includes(role)) return null;
  const supabase = getAdminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, calendar_link, daily_interview_target, recruiter_type")
    .eq("id", user.id)
    .single();
  if (!profile) return null;
  return { user, profile: { ...profile, role } };
}

export async function GET(req: NextRequest) {
  const auth = await getRecruiterUser(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { user, profile } = auth;
  const supabase = getAdminClient();
  const today = new Date().toISOString().split("T")[0];
  const todayStart = `${today}T00:00:00.000Z`;
  const todayEnd = `${today}T23:59:59.999Z`;

  // Parallel fetches
  const [
    interviewsRes,
    socialRes,
    lane1Res,
    lane2Res,
    lane3Res,
    threadsRes,
  ] = await Promise.all([
    // KPI: completed interviews today for this recruiter
    supabase
      .from("candidates")
      .select("id", { count: "exact", head: true })
      .eq("assigned_recruiter", user.id)
      .eq("second_interview_status", "completed")
      .gte("second_interview_completed_at", todayStart)
      .lte("second_interview_completed_at", todayEnd),

    // KPI: social posts today
    supabase
      .from("social_posts")
      .select("id, post_url, created_at")
      .eq("recruiter_id", user.id)
      .eq("post_date", today)
      .order("created_at", { ascending: true }),

    // Lane 1: Resumes to review — interviews scheduled today or upcoming
    supabase
      .from("candidates")
      .select("id, display_name, full_name, role_category, profile_photo_url, second_interview_scheduled_at, screening_score, resume_url, recruiter_ai_score_results")
      .eq("assigned_recruiter", user.id)
      .eq("second_interview_status", "scheduled")
      .gte("second_interview_scheduled_at", todayStart)
      .order("second_interview_scheduled_at", { ascending: true }),

    // Lane 2: Profiles to submit — interview completed, not yet submitted, no pending revision
    supabase
      .from("candidates")
      .select("id, display_name, full_name, role_category, profile_photo_url, screening_score, second_interview_completed_at, admin_status, profile_photo_url, tagline, bio, resume_url, payout_method, id_verification_status, voice_recording_1_url, voice_recording_2_url, english_mc_score, recruiter_ai_score_results, video_intro_url, id_verification_consent")
      .eq("assigned_recruiter", user.id)
      .eq("second_interview_status", "completed")
      .not("admin_status", "in", '("pending_speaking_review","approved","deactivated")'),

    // Lane 3: Revision follow-ups — pending revisions for assigned candidates
    supabase
      .from("profile_revisions")
      .select("id, candidate_id, items, status, created_at, candidates!inner(id, display_name, full_name, role_category, profile_photo_url, assigned_recruiter)")
      .eq("status", "pending")
      .eq("candidates.assigned_recruiter", user.id),

    // Message threads
    supabase
      .from("recruiter_messages")
      .select("candidate_id, sender_role, body, created_at, read_at")
      .eq("recruiter_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

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
    (c: { id: string; admin_status: string }) =>
      !candidatesWithPendingRevisions.has(c.id) && c.admin_status !== "pending_speaking_review"
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
    lane1: lane1Res.data || [],
    lane2: lane2Filtered,
    lane3: lane3Data,
    threads,
    profile: {
      role: profile.role,
      calendarLink: profile.calendar_link,
    },
  });
}
