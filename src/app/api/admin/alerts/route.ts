import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { countByPriority, deriveAlerts } from "@/lib/adminAlerts";

/**
 * Just the counts the attention bell needs.
 *
 * Deliberately not `/api/admin/command-center`: that route runs about thirty
 * queries and builds warm-lead and client-health tables, which is fine once on
 * a dashboard and wasteful on a poll from every page. This is nine head
 * counts and one small select.
 *
 * Recruiting managers are allowed here, unlike command-center, because none of
 * these numbers is revenue — they are queue depths and vendor state, which a
 * manager both may see and needs to.
 */
function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  if (!user || (role !== "admin" && role !== "recruiting_manager")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const db = admin();
  const now = new Date().toISOString();

  const [
    totalRes, reviewRes, routingRes, holdRes, lockoutRes,
    bansRes, disputesRes, vendorsRes, rolesRes, clientsRes, engRes, viewsRes,
  ] = await Promise.all([
    db.from("candidates").select("id", { count: "exact", head: true }),
    db.from("candidates").select("id", { count: "exact", head: true }).in("admin_status", ["pending_review", "profile_review"]),
    db.from("candidates").select("id", { count: "exact", head: true }).eq("assignment_pending_review", true),
    db.from("candidates").select("id", { count: "exact", head: true }).eq("screening_tag", "Hold"),
    db.from("candidates").select("id", { count: "exact", head: true }).gt("test_lockout_until", now),
    db.from("candidates").select("id", { count: "exact", head: true }).eq("ban_pending_review", true),
    db.from("disputes").select("id", { count: "exact", head: true }).is("resolved_at", null),
    db.from("vendor_health").select("vendor, ok"),
    db.from("candidates").select("role_category, admin_status"),
    db.from("clients").select("id"),
    db.from("engagements").select("client_id, status"),
    db.from("profile_views").select("client_id").gte("created_at", new Date(Date.now() - 14 * 86_400_000).toISOString()),
  ]);

  // Thin bench depth, same rule the dashboard uses: fewer than two candidates
  // in the pipeline for every one already live, in a category that has any.
  const roleStats = new Map<string, { live: number; pending: number }>();
  for (const c of rolesRes.data ?? []) {
    const key = c.role_category || "Unknown";
    if (!roleStats.has(key)) roleStats.set(key, { live: 0, pending: 0 });
    const e = roleStats.get(key)!;
    if (c.admin_status === "approved") e.live += 1;
    else if (c.admin_status !== "rejected" && c.admin_status !== "deactivated") e.pending += 1;
  }
  let thinRoles = 0;
  for (const [, s] of roleStats) if (s.live > 0 && s.pending / s.live < 2) thinRoles += 1;

  // Clients with no active engagement — the "browsed and never hired" set.
  const activeClients = new Set((engRes.data ?? []).filter((e) => e.status === "active").map((e) => e.client_id));
  const coldClients = (clientsRes.data ?? []).filter((c) => !activeClients.has(c.id)).length;

  const alerts = deriveAlerts({
    totalCandidates: totalRes.count ?? 0,
    pendingProfileReview: reviewRes.count ?? 0,
    needsRouting: routingRes.count ?? 0,
    screeningHold: holdRes.count ?? 0,
    testLockouts: lockoutRes.count ?? 0,
    coldClients,
    thinRoles,
    pendingBans: bansRes.count ?? 0,
    openDisputes: disputesRes.count ?? 0,
    vendorsDown: (vendorsRes.data ?? []).filter((v) => !v.ok).map((v) => v.vendor),
  });

  return NextResponse.json({
    alerts,
    counts: countByPriority(alerts),
    // So the bell can say when it last managed to look, rather than showing a
    // stale count as if it were current.
    checkedAt: new Date().toISOString(),
    viewsSeen: (viewsRes.data ?? []).length,
  });
}
