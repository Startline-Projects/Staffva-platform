import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function getAuthorizedProfile(req: NextRequest) {
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
  if (!profile || !["admin", "recruiting_manager"].includes(profile.role)) return null;
  return profile as { id: string; role: string };
}

export async function GET(req: NextRequest) {
  const profile = await getAuthorizedProfile(req);
  if (!profile) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await admin()
    .from("profiles")
    .select("id, full_name, email, calendar_link")
    .in("role", ["recruiter", "recruiting_manager", "admin"])
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ recruiters: data || [] });
}
