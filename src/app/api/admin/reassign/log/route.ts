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

  const { searchParams } = new URL(req.url);
  const candidateId = searchParams.get("candidateId");
  if (!candidateId) return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });

  const supabase = admin();

  const { data: rows, error } = await supabase
    .from("recruiter_reassignment_log")
    .select("id, reassigned_at, reason, from_recruiter_id, to_recruiter_id, reassigned_by")
    .eq("candidate_id", candidateId)
    .order("reassigned_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ log: [] });

  // Collect all profile IDs to fetch in one query
  const profileIds = new Set<string>();
  for (const row of rows) {
    if (row.from_recruiter_id) profileIds.add(row.from_recruiter_id);
    if (row.to_recruiter_id) profileIds.add(row.to_recruiter_id);
    if (row.reassigned_by) profileIds.add(row.reassigned_by);
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", [...profileIds]);

  const nameMap: Record<string, string> = {};
  for (const p of profiles || []) nameMap[p.id] = p.full_name || p.id;

  const log = rows.map((row) => ({
    id: row.id,
    reassigned_at: row.reassigned_at,
    reason: row.reason,
    from_name: row.from_recruiter_id ? (nameMap[row.from_recruiter_id] || "Unknown") : null,
    to_name: nameMap[row.to_recruiter_id] || "Unknown",
    reassigned_by_name: nameMap[row.reassigned_by] || "Unknown",
  }));

  return NextResponse.json({ log });
}
