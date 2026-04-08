import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const TEAM_THREAD_ID = "00000000-0000-0000-0000-000000000001";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getTeamUser(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await anonClient.auth.getUser(token);
  if (!user) return null;
  const supabase = getAdminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .single();
  if (!profile || !["recruiter", "recruiting_manager", "admin"].includes(profile.role)) return null;
  return { user, profile };
}

// GET — list threads for current user with unread counts and last messages
export async function GET(req: NextRequest) {
  const auth = await getTeamUser(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getAdminClient();
  const profileId = auth.profile.id;

  // Get all thread memberships for this user
  const { data: memberships } = await supabase
    .from("internal_thread_members")
    .select("thread_id, last_read_at")
    .eq("profile_id", profileId);

  const threadIds = (memberships || []).map((m) => m.thread_id);
  const lastReadMap = new Map((memberships || []).map((m) => [m.thread_id, m.last_read_at as string | null]));

  if (threadIds.length === 0) {
    return NextResponse.json({ threads: [], teamMembers: [] });
  }

  // Fetch threads, all messages (for last message + unread), and DM member profiles in parallel
  const [threadsRes, allMessagesRes, dmMembersRes] = await Promise.all([
    supabase
      .from("internal_threads")
      .select("id, name, is_group, created_at")
      .in("id", threadIds),

    supabase
      .from("internal_messages")
      .select("id, thread_id, sender_id, body, created_at")
      .in("thread_id", threadIds)
      .order("created_at", { ascending: false }),

    supabase
      .from("internal_thread_members")
      .select("thread_id, profile_id, profiles!inner(id, full_name)")
      .in("thread_id", threadIds)
      .neq("profile_id", profileId),
  ]);

  const threads = threadsRes.data || [];
  const allMessages = allMessagesRes.data || [];

  // Build last-message map and unread counts per thread
  const lastMessageMap: Record<string, { body: string; created_at: string }> = {};
  const unreadMap: Record<string, number> = {};
  for (const msg of allMessages) {
    if (!lastMessageMap[msg.thread_id]) {
      lastMessageMap[msg.thread_id] = { body: msg.body, created_at: msg.created_at };
    }
    if (msg.sender_id !== profileId) {
      const lastRead = lastReadMap.get(msg.thread_id);
      const isUnread = !lastRead || new Date(msg.created_at) > new Date(lastRead);
      if (isUnread) {
        unreadMap[msg.thread_id] = (unreadMap[msg.thread_id] || 0) + 1;
      }
    }
  }

  // Build other-member map for DM threads
  const otherMemberMap: Record<string, { id: string; full_name: string }> = {};
  for (const m of dmMembersRes.data || []) {
    otherMemberMap[m.thread_id] = {
      id: m.profile_id,
      full_name: ((m.profiles as unknown) as { id: string; full_name: string })?.full_name || "Team Member",
    };
  }

  const result = threads.map((t) => ({
    id: t.id,
    name: t.is_group ? (t.name || "Group") : (otherMemberMap[t.id]?.full_name || "Team Member"),
    is_group: t.is_group,
    other_profile_id: t.is_group ? null : (otherMemberMap[t.id]?.id || null),
    last_message: lastMessageMap[t.id]?.body || null,
    last_message_at: lastMessageMap[t.id]?.created_at || t.created_at,
    unread_count: unreadMap[t.id] || 0,
    created_at: t.created_at,
  }));

  // Team members list (only for admin/recruiting_manager who can start DMs)
  let teamMembers: { id: string; full_name: string; role: string }[] = [];
  if (auth.profile.role === "admin" || auth.profile.role === "recruiting_manager") {
    const { data: members } = await supabase
      .from("profiles")
      .select("id, full_name, role")
      .in("role", ["recruiter", "recruiting_manager", "admin"])
      .neq("id", profileId)
      .order("full_name");
    teamMembers = members || [];
  }

  return NextResponse.json({ threads: result, teamMembers, profileId });
}

// POST — create a new DM thread (admin/recruiting_manager only)
export async function POST(req: NextRequest) {
  const auth = await getTeamUser(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (auth.profile.role !== "admin" && auth.profile.role !== "recruiting_manager") {
    return NextResponse.json({ error: "Only managers can create direct message threads" }, { status: 403 });
  }

  const { memberId } = await req.json();
  if (!memberId) return NextResponse.json({ error: "Missing memberId" }, { status: 400 });

  const supabase = getAdminClient();
  const profileId = auth.profile.id;

  // Check if a DM already exists between these two users
  const [myMembershipsRes, theirMembershipsRes] = await Promise.all([
    supabase.from("internal_thread_members").select("thread_id").eq("profile_id", profileId),
    supabase.from("internal_thread_members").select("thread_id").eq("profile_id", memberId),
  ]);

  const myThreadIds = new Set((myMembershipsRes.data || []).map((m) => m.thread_id));
  const theirThreadIds = (theirMembershipsRes.data || []).map((m) => m.thread_id);
  const commonIds = theirThreadIds.filter((id) => myThreadIds.has(id));

  if (commonIds.length > 0) {
    const { data: existing } = await supabase
      .from("internal_threads")
      .select("id")
      .in("id", commonIds)
      .eq("is_group", false)
      .limit(1)
      .maybeSingle();
    if (existing) return NextResponse.json({ threadId: existing.id, existing: true });
  }

  // Create new DM thread
  const { data: newThread, error } = await supabase
    .from("internal_threads")
    .insert({ is_group: false })
    .select("id")
    .single();

  if (error || !newThread) return NextResponse.json({ error: "Failed to create thread" }, { status: 500 });

  await supabase.from("internal_thread_members").insert([
    { thread_id: newThread.id, profile_id: profileId },
    { thread_id: newThread.id, profile_id: memberId },
  ]);

  return NextResponse.json({ threadId: newThread.id, existing: false });
}
