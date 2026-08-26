import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { selectIn } from "@/lib/selectIn";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const serverSupabase = await createServerClient();
  const { data: { user } } = await serverSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || (profile.role !== "admin" && profile.role !== "recruiting_manager")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = getAdminClient();

  // Get all flagged or duplicate records
  const { data: records } = await supabase
    .from("verified_identities")
    .select("*")
    .or("is_duplicate.eq.true,flagged_for_review.eq.true")
    .order("created_at", { ascending: false });

  if (!records || records.length === 0) {
    return NextResponse.json({ records: [], stats: { duplicates: 0, flagged: 0 } });
  }

  // Get candidate details for all referenced IDs
  const candidateIds = new Set<string>();
  for (const r of records) {
    if (r.candidate_id) candidateIds.add(r.candidate_id);
    if (r.duplicate_of_candidate_id) candidateIds.add(r.duplicate_of_candidate_id);
  }

  const { data: candidates } = await selectIn([...candidateIds], (chunk) =>
    supabase
      .from("candidates")
      .select("id, display_name, full_name, email, country, role_category, admin_status, profile_photo_url")
      .in("id", chunk)
  );

  const candidateMap = new Map((candidates || []).map((c) => [c.id, c]));

  // Get active lockouts
  const hashes = records.map((r) => r.identity_hash).filter(Boolean);
  const { data: lockouts } = await supabase
    .from("english_test_lockouts")
    .select("identity_hash, lockout_expires_at")
    .in("identity_hash", hashes.length > 0 ? hashes : ["none"])
    .gt("lockout_expires_at", new Date().toISOString());

  const lockoutMap = new Map((lockouts || []).map((l) => [l.identity_hash, l.lockout_expires_at]));

  const enriched = records.map((r) => ({
    ...r,
    candidate: candidateMap.get(r.candidate_id) || null,
    original_candidate: r.duplicate_of_candidate_id ? candidateMap.get(r.duplicate_of_candidate_id) || null : null,
    lockout_expires: lockoutMap.get(r.identity_hash) || null,
  }));

  return NextResponse.json({
    records: enriched,
    stats: {
      duplicates: records.filter((r) => r.is_duplicate).length,
      flagged: records.filter((r) => r.flagged_for_review).length,
    },
  });
}
