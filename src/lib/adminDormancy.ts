import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { DORMANT_AFTER_DAYS } from "@/lib/adminAlerts";
import { loadAwaitingThreads } from "@/lib/recruiterThread";
import { isLive } from "@/lib/candidateStatus";

/**
 * Candidates parked with a specialist who isn't there.
 *
 * `/admin/performance` has counted dormant specialists since step 13, but
 * counting them on a page nobody has a reason to open is not the same as the
 * panel knowing. Nothing else treated an assignment to an absent person as
 * different from a working one — which makes it WORSE than no assignment,
 * because a candidate with `assigned_recruiter` set looks handled and stops
 * appearing anywhere that asks who is unrouted.
 *
 * The three conditions here are separate on purpose and one of them is not a
 * queue:
 *
 *   · a queue held by someone who has not signed in       (nobody is working it)
 *   · a live candidate with no specialist at all          (nobody owns them)
 *   · a candidate waiting on a reply                      (someone is being ignored)
 *
 * Only the third has a person on the other end wondering why nobody answered,
 * so it is the one that outranks the rest.
 *
 * "Dormant" is `DORMANT_AFTER_DAYS` from adminAlerts, not a second
 * threshold — two definitions of absent would disagree the first time either
 * moved, and the page and the alert would then contradict each other on the
 * same screen.
 *
 * Server-only: reads SUPABASE_SERVICE_ROLE_KEY.
 *
 * Cached for a few seconds because the attention bell polls this from every
 * open admin page. Two of the reads here are not cheap — `listUsers` is an
 * Auth API round-trip, and `loadAwaitingThreads` walks the whole message
 * table rather than capping, deliberately, so that a long thread list can
 * never render as a short one. One admin polling at 60s would be fine; five
 * with tabs open would be five scans a minute for an answer that changes when
 * somebody signs in. The window is shorter than the poll, so a bell never
 * shows an answer older than its own interval.
 */

const CACHE_MS = 45_000;
let cache: { at: number; facts: DormancyFacts } | null = null;

export interface DormantSpecialist {
  id: string;
  name: string;
  email: string;
  role: string;
  assigned: number;
  lastSignInAt: string | null;
  /** null = never signed in, which is not zero days. */
  daysDormant: number | null;
}

export interface DormancyFacts {
  /** Dormant specialists holding at least one candidate. */
  dormantWithQueue: DormantSpecialist[];
  assignedToDormant: number;
  /** Longest absence among those holding a queue; null if none do. */
  longestDormancyDays: number | null;
  /** Live candidates with no specialist at all. */
  unassignedLive: number;
  /** Threads awaiting a staff reply — `loadAwaitingThreads`, not a second rule. */
  awaitingTotal: number;
  awaitingOnDormant: number;
  longestWaitDays: number | null;
  /** Candidates who have never had a single reply from anyone. */
  neverAnswered: number;
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

/** null means a read failed — never "nothing is dormant". */
export async function loadDormancyFacts(): Promise<DormancyFacts | null> {
  // The permission check is never cached, only the answer.
  if (!(await assertStaff())) return null;
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.facts;

  const db = serviceClient();

  const [peopleRes, candRes, authRes, awaiting] = await Promise.all([
    db.from("profiles").select("id, full_name, email, role").in("role", ["recruiter", "recruiting_manager"]),
    db.from("candidates").select("assigned_recruiter, admin_status"),
    db.auth.admin.listUsers({ page: 1, perPage: 200 }),
    // Throws on a failed scan rather than returning a short list, so a
    // half-read never renders as "fewer people are waiting".
    loadAwaitingThreads().catch(() => null),
  ]);

  if (peopleRes.error || !peopleRes.data) return null;
  if (candRes.error || !candRes.data) return null;
  if (awaiting === null) return null;

  const lastSignIn = new Map((authRes.data?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null]));
  const now = Date.now();
  const daysSince = (iso: string | null) =>
    iso === null ? null : Math.floor((now - new Date(iso).getTime()) / 86_400_000);

  // `assigned_recruiter` is a text column holding uuids, so it is matched as a
  // string rather than joined.
  const assignedCount = new Map<string, number>();
  let unassignedLive = 0;
  for (const c of candRes.data) {
    const who = c.assigned_recruiter as string | null;
    if (who) assignedCount.set(who, (assignedCount.get(who) ?? 0) + 1);
    else if (isLive(c.admin_status)) unassignedLive += 1;
  }

  const dormantIds = new Set<string>();
  const dormantWithQueue: DormantSpecialist[] = [];

  for (const p of peopleRes.data) {
    const seen = lastSignIn.get(p.id) ?? null;
    const days = daysSince(seen);
    // Never signed in counts as dormant: an account that has never been used
    // is not a person working a queue.
    const isDormant = days === null || days >= DORMANT_AFTER_DAYS;
    if (!isDormant) continue;
    dormantIds.add(p.id);

    const assigned = assignedCount.get(p.id) ?? 0;
    if (assigned > 0) {
      dormantWithQueue.push({
        id: p.id,
        name: p.full_name || p.email,
        email: p.email,
        role: p.role,
        assigned,
        lastSignInAt: seen,
        daysDormant: days,
      });
    }
  }

  dormantWithQueue.sort((a, b) => b.assigned - a.assigned);

  const dormancyDays = dormantWithQueue.map((s) => s.daysDormant).filter((d): d is number => d !== null);

  const waits = awaiting.map((t) => t.daysWaiting).filter((d): d is number => typeof d === "number");

  const facts: DormancyFacts = {
    dormantWithQueue,
    assignedToDormant: dormantWithQueue.reduce((s, x) => s + x.assigned, 0),
    longestDormancyDays: dormancyDays.length ? Math.max(...dormancyDays) : null,
    unassignedLive,
    awaitingTotal: awaiting.length,
    awaitingOnDormant: awaiting.filter((t) => t.assigneeId !== null && dormantIds.has(t.assigneeId)).length,
    longestWaitDays: waits.length ? Math.max(...waits) : null,
    neverAnswered: awaiting.filter((t) => !t.everReplied).length,
  };

  // Only a complete read is cached; a failure above returned null already and
  // must not be remembered as an answer.
  cache = { at: Date.now(), facts };
  return facts;
}

/** After a write that moves a queue, so the next read is not the stale one. */
export function invalidateDormancyCache() {
  cache = null;
}

export { DORMANT_AFTER_DAYS };
