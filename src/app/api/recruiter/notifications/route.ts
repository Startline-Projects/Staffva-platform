import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function getRecruiterProfile(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user } } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ).auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await admin()
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();
  if (!profile || !["recruiter", "recruiting_manager", "admin"].includes(profile.role)) return null;
  return profile as { id: string; role: string };
}

// GET — fetch unread notifications for the current recruiter
export async function GET(req: NextRequest) {
  const profile = await getRecruiterProfile(req);
  if (!profile) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await admin()
    .from("recruiter_notifications")
    .select("id, candidate_id, message, priority, link, created_at, read_at")
    .eq("recruiter_id", profile.id)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notifications: data || [] });
}

// PATCH — mark one or all notifications as read
export async function PATCH(req: NextRequest) {
  const profile = await getRecruiterProfile(req);
  if (!profile) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { notificationId, markAll } = await req.json();

  const supabase = admin();
  const now = new Date().toISOString();

  if (markAll) {
    const { error } = await supabase
      .from("recruiter_notifications")
      .update({ read_at: now })
      .eq("recruiter_id", profile.id)
      .is("read_at", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (notificationId) {
    const { error } = await supabase
      .from("recruiter_notifications")
      .update({ read_at: now })
      .eq("id", notificationId)
      .eq("recruiter_id", profile.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    return NextResponse.json({ error: "Provide notificationId or markAll" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
