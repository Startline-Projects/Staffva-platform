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
    .select("role, recruiter_type")
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

  const recruiterId = user.id.toString();

  // Step 1: Get all assigned candidates (name+photo for candidateMap, IDs for Lane 3 filter)
  const { data: assignedCandidates } = await supabase
    .from("candidates")
    .select("id, display_name, full_name, profile_photo_url")
    .eq("assigned_recruiter", recruiterId);
  const assignedCandidateIds = (assignedCandidates || []).map((c: { id: string }) => c.id);

  // Parallel fetches
  // Lane 1 (resumes to review before the call), Lane 2 (profiles to submit after
  // it), the "interviews completed today" KPI, the upcoming-bookings list and the
  // unmatched-bookings list have all been removed. Every one of them was keyed on
  // second_interview_status, which nothing sets any more, so each would render as
  // a permanently empty column on the recruiter's main screen. Approval is now
  // automatic once a candidate passes and completes their profile, so the
  // schedule -> interview -> score -> submit workflow they implemented no longer
  // exists. What is left is the work a specialist actually still does: their
  // assigned candidates, revision follow-ups, messages and social posts.
  const [
    socialRes,
    queueRes,
    lane3Res,
    threadsRes,
    pipelineRes,
  ] = await Promise.all([
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
      .not("admin_status", "eq", "approved")
      .order("ai_interview_completed_at", { ascending: true }),

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
      .select("id, display_name, role_category, profile_photo_url, admin_status, ai_interview_completed_at, ai_interview_score, created_at, recruiter_notes")
      .eq("assigned_recruiter", recruiterId)
      .order("created_at", { ascending: false }),

  ]);

  console.log(`[RECRUITER DASHBOARD] recruiterId: ${recruiterId}, assignedTotal: ${assignedCandidateIds.length}, Queue: ${queueRes.data?.length ?? 0}, Lane3: ${lane3Res.data?.length ?? 0}, errors: ${JSON.stringify({ q: queueRes.error?.message, l3: lane3Res.error?.message })}`);

  // Process social posts
  const socialPosts = socialRes.data || [];

  const lane3Data = lane3Res.data || [];

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

  return NextResponse.json({
    kpi: {
      recruiterType: profile.recruiter_type,
      socialPosts,
    },
    queue: queueRes.data || [],
    allAssigned: assignedCandidates || [],
    lane3: lane3Data,
    pipeline: pipelineRes.data || [],
    threads,
    profile: {
      role: profile.role,
    },
  });
}
