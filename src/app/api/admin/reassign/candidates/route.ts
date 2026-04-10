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

  const supabase = admin();

  // Fetch all non-rejected candidates with their recruiter assignment
  const { data: candidates, error } = await supabase
    .from("candidates")
    .select("id, display_name, full_name, email, role_category, admin_status, assigned_recruiter, created_at")
    .not("admin_status", "eq", "rejected")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!candidates || candidates.length === 0) return NextResponse.json({ candidates: [] });

  // Collect recruiter IDs
  const recruiterIds = new Set<string>();
  for (const c of candidates) {
    if (c.assigned_recruiter) recruiterIds.add(c.assigned_recruiter);
  }

  let recruiterNameMap: Record<string, string> = {};
  if (recruiterIds.size > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", [...recruiterIds]);
    for (const p of profiles || []) recruiterNameMap[p.id] = p.full_name || p.id;
  }

  const enriched = candidates.map((c) => ({
    id: c.id,
    display_name: c.display_name || c.full_name || "—",
    email: c.email,
    role_category: c.role_category,
    admin_status: c.admin_status,
    assigned_recruiter: c.assigned_recruiter,
    recruiter_name: c.assigned_recruiter ? (recruiterNameMap[c.assigned_recruiter] || "Unknown") : null,
    created_at: c.created_at,
  }));

  return NextResponse.json({ candidates: enriched });
}
