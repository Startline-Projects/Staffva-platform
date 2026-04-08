import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getTeamUser(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user } } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ).auth.getUser(token);
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

// GET — get messages for a thread (must be a member)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getTeamUser(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: threadId } = await params;
  const supabase = getAdminClient();

  // Verify membership
  const { data: membership } = await supabase
    .from("internal_thread_members")
    .select("profile_id")
    .eq("thread_id", threadId)
    .eq("profile_id", auth.profile.id)
    .maybeSingle();

  if (!membership) return NextResponse.json({ error: "Not a member of this thread" }, { status: 403 });

  const { data: messages, error } = await supabase
    .from("internal_messages")
    .select("id, sender_id, body, created_at, profiles!inner(id, full_name)")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result = (messages || []).map((m) => ({
    id: m.id,
    sender_id: m.sender_id,
    sender_name: ((m.profiles as unknown) as { id: string; full_name: string })?.full_name || "Team Member",
    body: m.body,
    created_at: m.created_at,
    is_mine: m.sender_id === auth.profile.id,
  }));

  return NextResponse.json({ messages: result });
}

// POST — send a message to the thread (must be a member)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getTeamUser(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: threadId } = await params;
  const supabase = getAdminClient();

  // Verify membership
  const { data: membership } = await supabase
    .from("internal_thread_members")
    .select("profile_id")
    .eq("thread_id", threadId)
    .eq("profile_id", auth.profile.id)
    .maybeSingle();

  if (!membership) return NextResponse.json({ error: "Not a member of this thread" }, { status: 403 });

  const { body } = await req.json();
  if (!body?.trim()) return NextResponse.json({ error: "Message body required" }, { status: 400 });

  const { data: message, error } = await supabase
    .from("internal_messages")
    .insert({
      thread_id: threadId,
      sender_id: auth.profile.id,
      body: body.trim(),
    })
    .select("id, sender_id, body, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Update last_read_at for the sender so their own message doesn't show as unread
  await supabase
    .from("internal_thread_members")
    .update({ last_read_at: message.created_at })
    .eq("thread_id", threadId)
    .eq("profile_id", auth.profile.id);

  return NextResponse.json({ message });
}
