import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { isLive } from "@/lib/candidateStatus";

/**
 * The integrity signals StaffVA actually records, and what each one is worth.
 *
 * There is no fraud-alert table and no security-incident table; this reads the
 * three things that do exist. Two of them need a caveat carried right next to
 * the number, because presented bare they claim more than they know:
 *
 *  · `cheat_log` holds one event type, `mouse_leave`, logged when the pointer
 *    leaves the window during the English test. A pointer leaving a browser
 *    window is not evidence of anything on its own, and the client code notes
 *    that mobile browsers fire it spuriously (it logs those but does not count
 *    them toward the flag).
 *  · `score_mismatch_flag` does not compare two scores. `gradeAttempt.ts` sets
 *    it to `overall > 80`, so it marks the strongest candidates and nothing
 *    else. The name is the only thing about it that suggests fraud.
 *
 * Server-only: reads SUPABASE_SERVICE_ROLE_KEY.
 */

export interface FlaggedCandidate {
  id: string;
  name: string;
  email: string | null;
  adminStatus: string | null;
  cheatFlagCount: number;
  windowExits: number;
  scoreMismatch: boolean;
}

export interface SafetyReport {
  candidates: FlaggedCandidate[];
  totals: {
    candidates: number;
    withAnySignal: number;
    withWindowExits: number;
    withScoreMismatch: number;
    liveWithAnySignal: number;
    windowExitEvents: number;
    rateLimitBuckets: number;
    rateLimitHits: number;
  };
  /** Actions ever taken: bans, rejections, appeals, lockouts, suspensions. */
  actions: {
    bansPending: number;
    bansEverRequested: number;
    rejections: number;
    appeals: number;
    lockoutsNow: number;
    lockoutsEver: number;
    suspendedStaff: number;
  };
}

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function assertStaff() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  return Boolean(user) && (role === "admin" || role === "recruiting_manager");
}

export async function loadSafetyReport(): Promise<SafetyReport | null> {
  if (!(await assertStaff())) return null;
  const db = serviceClient();

  const [flaggedRes, logRes, totalRes, rateRes, banPendingRes, banEverRes, rejectedRes, appealsRes, lockNowRes, lockEverRes, suspendedRes] =
    await Promise.all([
      db
        .from("candidates")
        .select("id, full_name, display_name, email, admin_status, cheat_flag_count, score_mismatch_flag")
        .or("cheat_flag_count.gt.0,score_mismatch_flag.is.true"),
      db.from("cheat_log").select("candidate_id, event_type"),
      db.from("candidates").select("id", { count: "exact", head: true }),
      db.from("rate_limit_hits").select("bucket, hits"),
      db.from("candidates").select("id", { count: "exact", head: true }).eq("ban_pending_review", true),
      db.from("candidates").select("id", { count: "exact", head: true }).not("ban_requested_at", "is", null),
      db.from("candidates").select("id", { count: "exact", head: true }).not("rejected_at", "is", null),
      db.from("candidates").select("id", { count: "exact", head: true }).not("appeal_submitted_at", "is", null),
      db.from("candidates").select("id", { count: "exact", head: true }).gt("test_lockout_until", new Date().toISOString()),
      db.from("candidates").select("id", { count: "exact", head: true }).not("test_lockout_until", "is", null),
      db.from("profiles").select("id", { count: "exact", head: true }).not("suspended_at", "is", null),
    ]);

  if (flaggedRes.error) return null;

  const exitsByCandidate = new Map<string, number>();
  for (const row of logRes.data ?? []) {
    exitsByCandidate.set(row.candidate_id, (exitsByCandidate.get(row.candidate_id) ?? 0) + 1);
  }

  const candidates: FlaggedCandidate[] = (flaggedRes.data ?? [])
    .map((c) => ({
      id: c.id,
      name: c.full_name || c.display_name || "—",
      email: c.email,
      adminStatus: c.admin_status,
      cheatFlagCount: c.cheat_flag_count ?? 0,
      windowExits: exitsByCandidate.get(c.id) ?? 0,
      scoreMismatch: Boolean(c.score_mismatch_flag),
    }))
    .sort((a, b) => b.windowExits - a.windowExits || b.cheatFlagCount - a.cheatFlagCount);

  const rateRows = rateRes.data ?? [];

  return {
    candidates,
    totals: {
      candidates: totalRes.count ?? 0,
      withAnySignal: candidates.length,
      withWindowExits: candidates.filter((c) => c.cheatFlagCount > 0).length,
      withScoreMismatch: candidates.filter((c) => c.scoreMismatch).length,
      liveWithAnySignal: candidates.filter((c) => isLive(c.adminStatus)).length,
      windowExitEvents: (logRes.data ?? []).length,
      rateLimitBuckets: rateRows.length,
      rateLimitHits: rateRows.reduce((s, r) => s + (r.hits ?? 0), 0),
    },
    actions: {
      bansPending: banPendingRes.count ?? 0,
      bansEverRequested: banEverRes.count ?? 0,
      rejections: rejectedRes.count ?? 0,
      appeals: appealsRes.count ?? 0,
      lockoutsNow: lockNowRes.count ?? 0,
      lockoutsEver: lockEverRes.count ?? 0,
      suspendedStaff: suspendedRes.count ?? 0,
    },
  };
}


/* ══════════════════════ PENDING BANS ══════════════════════ */

export interface PendingBan {
  id: string;
  name: string;
  roleCategory: string | null;
  country: string | null;
  adminStatus: string | null;
  reason: string | null;
  requestedAt: string | null;
  requestedByName: string | null;
}

/** null means the read failed — never "no pending bans". */
export async function loadPendingBans(): Promise<PendingBan[] | null> {
  if (!(await assertStaff())) return null;
  const db = serviceClient();

  const { data, error } = await db
    .from("candidates")
    .select("id, full_name, display_name, role_category, country, admin_status, ban_reason, ban_requested_at, ban_requested_by")
    .eq("ban_pending_review", true)
    .order("ban_requested_at", { ascending: true });

  if (error) return null;
  if (!data?.length) return [];

  const requesterIds = [...new Set(data.map((c) => c.ban_requested_by).filter(Boolean))] as string[];
  const { data: people } = requesterIds.length
    ? await db.from("profiles").select("id, full_name, email").in("id", requesterIds)
    : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]));

  return data.map((c) => ({
    id: c.id,
    name: c.display_name || c.full_name || "—",
    roleCategory: c.role_category,
    country: c.country,
    adminStatus: c.admin_status,
    reason: c.ban_reason,
    requestedAt: c.ban_requested_at,
    // Resolved per row. The old page told every admin the requests came from
    // one named manager, which was true of the person who happened to be
    // requesting them and of nobody else.
    requestedByName: c.ban_requested_by ? (names.get(c.ban_requested_by) ?? null) : null,
  }));
}
