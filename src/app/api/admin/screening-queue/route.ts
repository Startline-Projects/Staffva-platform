import { NextResponse } from "next/server";
import { countOrNull, sumOrNull } from "@/lib/readCount";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const serverSupabase = await createServerClient();
  const { data: { user } } = await serverSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = getAdminClient();
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "admin" && profile.role !== "recruiter" && profile.role !== "recruiting_manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getAdminClient();

  // Get counts by status
  const statuses = ["pending", "processing", "complete", "failed", "rate_limited"];
  // null = that status could not be counted. `count || 0` used to make a
  // failed read of the FAILED bucket render as "Failed: 0" — the one tile on
  // this widget whose zero is read as an all-clear.
  const counts: Record<string, number | null> = {};

  for (const status of statuses) {
    counts[status] = countOrNull(await supabase
      .from("screening_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", status));
  }

  // Get recent failures
  const { data: recentFailures } = await supabase
    .from("screening_queue")
    .select("id, candidate_id, error_text, retry_count, created_at")
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(5);

  // Get total processed today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const processedToday = countOrNull(await supabase
    .from("screening_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "complete")
    .gte("processed_at", today.toISOString()));

  return NextResponse.json({
    counts,
    total: sumOrNull(...Object.values(counts)),
    processedToday,
    recentFailures: recentFailures || [],
  });
}
