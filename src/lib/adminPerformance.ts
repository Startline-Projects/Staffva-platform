import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * How the talent specialists are actually doing.
 *
 * Only four things about a specialist are measurable from this database, and
 * the page shows those four rather than inventing a score:
 *
 *   · how many candidates name them in `candidates.assigned_recruiter`
 *   · how many role categories they claim in `recruiter_assignments`
 *   · how many messages they have sent a candidate
 *   · when they last signed in
 *
 * There is no throughput number and no time-to-decision. Nothing records who
 * moved a candidate through a stage — `candidate_status_events.actor_id` is
 * null on all 445 rows — so any "approvals per specialist" figure would be
 * invented. That gap is why `admin_actions` now exists; it will start
 * answering this question for decisions taken after it ships.
 *
 * Server-only: reads SUPABASE_SERVICE_ROLE_KEY.
 */

export interface SpecialistPerformance {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  assigned: number;
  categories: number;
  messagesSent: number;
  reassignedAway: number;
  reassignedTo: number;
  lastSignInAt: string | null;
  /** Whole days since last sign-in; null if they never have. */
  daysSinceSignIn: number | null;
}

export interface PerformanceReport {
  specialists: SpecialistPerformance[];
  totals: {
    assigned: number;
    /** Candidates held by someone who has not signed in for 30+ days. */
    assignedToDormant: number;
    dormantSpecialists: number;
    messagesSent: number;
    reassignments: number;
  };
  internal: { threads: number; messages: number; members: number };
}

const DORMANT_DAYS = 30;

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function assertStaff() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  return Boolean(user) && (role === "admin" || role === "recruiting_manager");
}

/** null means the read failed — never "no specialists". */
export async function loadPerformance(): Promise<PerformanceReport | null> {
  if (!(await assertStaff())) return null;
  const db = serviceClient();

  const { data: people, error } = await db
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .in("role", ["recruiter", "recruiting_manager"])
    .order("full_name");

  if (error || !people) return null;

  const [assignedRes, catsRes, msgsRes, reassignRes, threadsRes, msgCountRes, membersRes] = await Promise.all([
    db.from("candidates").select("assigned_recruiter").not("assigned_recruiter", "is", null),
    db.from("recruiter_assignments").select("recruiter_id"),
    db.from("recruiter_messages").select("recruiter_id"),
    db.from("recruiter_reassignment_log").select("from_recruiter_id, to_recruiter_id"),
    db.from("internal_threads").select("id", { count: "exact", head: true }),
    db.from("internal_messages").select("id", { count: "exact", head: true }),
    db.from("internal_thread_members").select("id", { count: "exact", head: true }),
  ]);

  const tally = <T,>(rows: T[] | null, key: (r: T) => string | null | undefined) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      const k = key(r);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };

  // `assigned_recruiter` is a text column holding uuids, so it is compared as
  // a string rather than joined.
  const assigned = tally(assignedRes.data, (r) => r.assigned_recruiter as string);
  const cats = tally(catsRes.data, (r) => r.recruiter_id);
  const msgs = tally(msgsRes.data, (r) => r.recruiter_id);
  const away = tally(reassignRes.data, (r) => r.from_recruiter_id);
  const toward = tally(reassignRes.data, (r) => r.to_recruiter_id);

  const { data: authData } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const lastSignIn = new Map((authData?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null]));

  const now = Date.now();

  const specialists: SpecialistPerformance[] = people.map((p) => {
    const seen = lastSignIn.get(p.id) ?? null;
    return {
      id: p.id,
      name: p.full_name || p.email,
      email: p.email,
      role: p.role,
      isActive: p.is_active,
      assigned: assigned.get(p.id) ?? 0,
      categories: cats.get(p.id) ?? 0,
      messagesSent: msgs.get(p.id) ?? 0,
      reassignedAway: away.get(p.id) ?? 0,
      reassignedTo: toward.get(p.id) ?? 0,
      lastSignInAt: seen,
      daysSinceSignIn: seen ? Math.floor((now - new Date(seen).getTime()) / 86_400_000) : null,
    };
  }).sort((a, b) => b.assigned - a.assigned);

  const dormant = specialists.filter(
    (s) => s.daysSinceSignIn === null || s.daysSinceSignIn >= DORMANT_DAYS
  );

  return {
    specialists,
    totals: {
      assigned: specialists.reduce((s, x) => s + x.assigned, 0),
      assignedToDormant: dormant.reduce((s, x) => s + x.assigned, 0),
      dormantSpecialists: dormant.filter((s) => s.assigned > 0).length,
      messagesSent: specialists.reduce((s, x) => s + x.messagesSent, 0),
      reassignments: (reassignRes.data ?? []).length,
    },
    internal: {
      threads: threadsRes.count ?? 0,
      messages: msgCountRes.count ?? 0,
      members: membersRes.count ?? 0,
    },
  };
}

export const DORMANT_AFTER_DAYS = DORMANT_DAYS;
