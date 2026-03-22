import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.user_metadata?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const admin = getAdminClient();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Total live candidates
  const { count: liveCandidates } = await admin
    .from("candidates")
    .select("*", { count: "exact", head: true })
    .eq("admin_status", "approved");

  // Active locked engagements
  const { count: activeEngagements } = await admin
    .from("engagements")
    .select("*", { count: "exact", head: true })
    .eq("status", "active");

  // MRR from platform fees (sum of platform_fee_usd for active engagements)
  const { data: activeEngData } = await admin
    .from("engagements")
    .select("platform_fee_usd")
    .eq("status", "active");

  const mrr = (activeEngData || []).reduce(
    (sum, e) => sum + (Number(e.platform_fee_usd) || 0),
    0
  );

  // New candidates this week / month
  const { count: candidatesThisWeek } = await admin
    .from("candidates")
    .select("*", { count: "exact", head: true })
    .gte("created_at", weekAgo);

  const { count: candidatesThisMonth } = await admin
    .from("candidates")
    .select("*", { count: "exact", head: true })
    .gte("created_at", monthAgo);

  // New clients this week / month
  const { count: clientsThisWeek } = await admin
    .from("clients")
    .select("*", { count: "exact", head: true })
    .gte("created_at", weekAgo);

  const { count: clientsThisMonth } = await admin
    .from("clients")
    .select("*", { count: "exact", head: true })
    .gte("created_at", monthAgo);

  // Total message threads
  const { data: threadData } = await admin
    .from("messages")
    .select("thread_id");
  const uniqueThreads = new Set(
    (threadData || []).map((m) => m.thread_id)
  ).size;

  // Pending reviews
  const { count: pendingReviews } = await admin
    .from("candidates")
    .select("*", { count: "exact", head: true })
    .eq("admin_status", "pending_speaking_review");

  // Active disputes
  const { count: activeDisputes } = await admin
    .from("disputes")
    .select("*", { count: "exact", head: true })
    .is("resolved_at", null);

  return NextResponse.json({
    liveCandidates: liveCandidates || 0,
    activeEngagements: activeEngagements || 0,
    mrr: Math.round(mrr),
    candidatesThisWeek: candidatesThisWeek || 0,
    candidatesThisMonth: candidatesThisMonth || 0,
    clientsThisWeek: clientsThisWeek || 0,
    clientsThisMonth: clientsThisMonth || 0,
    totalThreads: uniqueThreads,
    pendingReviews: pendingReviews || 0,
    activeDisputes: activeDisputes || 0,
  });
}
