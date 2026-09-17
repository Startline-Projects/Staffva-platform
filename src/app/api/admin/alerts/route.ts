import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { countByPriority, deriveAlerts, type AlertInput } from "@/lib/adminAlerts";
import { loadDormancyFacts } from "@/lib/adminDormancy";
import { FailedReads } from "@/lib/readCount";
import { isLive } from "@/lib/candidateStatus";

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
 *
 * Dormancy is read alongside the counts rather than derived from them: whether
 * a queue is being worked is a fact about the specialist's sign-ins, and no
 * number of candidate rows can answer it.
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

  // Every number below feeds a threshold, so it has to stay a number — and a
  // false zero here does not show a wrong figure, it removes a row from a list
  // of problems. `failed.count()` hands back the zero and records the label in
  // one act, so no zero can reach deriveAlerts without being reportable. They
  // were two separate lists once; nothing kept them in step.
  const failed = new FailedReads();

  // null = the read failed. The spread below then contributes nothing and the
  // dormancy rows stay silent, rather than an unread count rendering as an
  // all-clear.
  const dormancy = await loadDormancyFacts();

  // Thin bench depth, same rule the dashboard uses: fewer than two candidates
  // in the pipeline for every one already live, in a category that has any.
  const roleStats = new Map<string, { live: number; pending: number }>();
  for (const c of failed.rows("role depth", rolesRes)) {
    const key = c.role_category || "Unknown";
    if (!roleStats.has(key)) roleStats.set(key, { live: 0, pending: 0 });
    const e = roleStats.get(key)!;
    if (isLive(c.admin_status)) e.live += 1;
    else if (c.admin_status !== "rejected" && c.admin_status !== "deactivated") e.pending += 1;
  }
  let thinRoles = 0;
  for (const [, s] of roleStats) if (s.live > 0 && s.pending / s.live < 2) thinRoles += 1;

  // Clients with no active engagement — the "browsed and never hired" set.
  const activeClients = new Set(failed.rows("engagements", engRes).filter((e) => e.status === "active").map((e) => e.client_id));
  const coldClients = failed.rows("clients", clientsRes).filter((c) => !activeClients.has(c.id)).length;

  const input: AlertInput = {
    totalCandidates: failed.count("candidate total", totalRes),
    pendingProfileReview: failed.count("profile reviews", reviewRes),
    needsRouting: failed.count("routing decisions", routingRes),
    screeningHold: failed.count("screening holds", holdRes),
    testLockouts: failed.count("test lockouts", lockoutRes),
    coldClients,
    thinRoles,
    pendingBans: failed.count("ban requests", bansRes),
    openDisputes: failed.count("open disputes", disputesRes),
    vendorsDown: failed.rows("vendor health", vendorsRes).filter((v) => !v.ok).map((v) => v.vendor),
    ...(dormancy
      ? {
          assignedToDormant: dormancy.assignedToDormant,
          dormantSpecialists: dormancy.dormantWithQueue.length,
          longestDormancyDays: dormancy.longestDormancyDays,
          unassignedLive: dormancy.unassignedLive,
          awaitingReply: dormancy.awaitingTotal,
          awaitingReplyOnDormant: dormancy.awaitingOnDormant,
          longestWaitDays: dormancy.longestWaitDays,
          neverAnswered: dormancy.neverAnswered,
        }
      : {}),
  };

  if (dormancy === null) failed.note("specialist queues and unanswered messages");
  // Assigned last: object-literal fields evaluate in order, and this has to see
  // every label the reads above left behind.
  input.failedChecks = failed.labels;

  const alerts = deriveAlerts(input);

  return NextResponse.json({
    alerts,
    // The dashboard derives the same list from its own payload and needs four
    // of these numbers that the command centre does not report. It used to
    // recover them by regex-matching the leading digits of alert titles, which
    // made every copy change a silent data change.
    input,
    counts: countByPriority(alerts),
    // So the bell can say when it last managed to look, rather than showing a
    // stale count as if it were current.
    checkedAt: new Date().toISOString(),
    // So the bell can say the dormancy rows are missing rather than absent.
    dormancyRead: dormancy !== null,
    viewsSeen: viewsRes.error || !viewsRes.data ? null : viewsRes.data.length,
  });
}
