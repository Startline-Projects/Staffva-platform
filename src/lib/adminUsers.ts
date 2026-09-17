import { createClient } from "@supabase/supabase-js";
import { countOrNull, sumOrNull } from "@/lib/readCount";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { isLive } from "@/lib/candidateStatus";

/**
 * The cross-population people directory behind `/admin/users`.
 *
 * StaffVA keeps its people in three unrelated places — `candidates`,
 * `clients`, and `profiles` (which holds specialists, managers and admins) —
 * and until now the only way to find somebody was to already know which of
 * the four pages they were on. This joins nothing; it queries the population
 * you asked for and hands back one row shape, so a single table can list any
 * of them.
 *
 * Every row carries where that person is *managed today*, which is not always
 * a detail page: there is no admin-facing candidate record yet, so candidates
 * point at the review queue. Rows never link somewhere that does not exist.
 *
 * Server-only: reads SUPABASE_SERVICE_ROLE_KEY. Do not import from a
 * "use client" module — the repo has no `server-only` package to stop you.
 */

export type Population = "candidates" | "clients" | "specialists" | "staff";

export const POPULATIONS: { id: Population; label: string }[] = [
  { id: "candidates", label: "Candidates" },
  { id: "clients", label: "Clients" },
  { id: "specialists", label: "Talent specialists" },
  { id: "staff", label: "Managers & admins" },
];

export interface UserRow {
  id: string;
  name: string;
  email: string | null;
  photoUrl: string | null;
  meta: string;
  status: { label: string; tone: "ok" | "warn" | "bad" | "mute" };
  joinedAt: string;
  /** Where this person is managed today. */
  href: string;
  hrefLabel: string;
  /** Public profile, only when one actually resolves. */
  publicHref: string | null;
}

export interface DirectoryPage {
  rows: UserRow[];
  total: number;
  page: number;
  pageSize: number;
}

export const PAGE_SIZE = 50;

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * PostgREST's `or=` takes a comma-separated list of filters wrapped in
 * parentheses, so a search for "Smith, J" or "O(x)" would be parsed as filter
 * syntax rather than as text. Strip the characters that carry meaning there
 * before they reach the query string. `%` and `_` are left alone: they are
 * ilike wildcards, which is a reasonable thing for a person to type.
 */
export function safeSearch(q: string): string {
  return q.replace(/[,()\\"]/g, " ").trim().slice(0, 120);
}

async function assertStaff() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  if (!user || (role !== "admin" && role !== "recruiting_manager")) return null;
  return { user, role };
}

/** null = that population could not be counted. `total` is null if any part is. */
export interface PopulationCounts {
  candidates: number | null;
  clients: number | null;
  specialists: number | null;
  staff: number | null;
  total: number | null;
}

export async function loadCounts(): Promise<PopulationCounts | null> {
  if (!(await assertStaff())) return null;
  const db = serviceClient();

  const [cand, cli, spec, stf] = await Promise.all([
    db.from("candidates").select("id", { count: "exact", head: true }),
    db.from("clients").select("id", { count: "exact", head: true }),
    db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "recruiter"),
    db.from("profiles").select("id", { count: "exact", head: true }).in("role", ["admin", "recruiting_manager"]),
  ]);

  const counts = {
    candidates: countOrNull(cand),
    clients: countOrNull(cli),
    specialists: countOrNull(spec),
    staff: countOrNull(stf),
  };
  // A total that silently left out a population it could not count would be
  // wrong by exactly the amount nobody can see.
  return { ...counts, total: sumOrNull(counts.candidates, counts.clients, counts.specialists, counts.staff) };
}

function candidateStatus(admin_status: string | null, banPending: boolean): UserRow["status"] {
  if (banPending) return { label: "Ban requested", tone: "bad" };
  switch (admin_status) {
    case "live":
    case "approved": return { label: "Live", tone: "ok" };
    case "revision_required": return { label: "Revisions asked", tone: "warn" };
    // Rejected is a settled outcome, not an alarm. Only a pending ban gets the
    // red treatment here — if both are red, the row that needs a decision
    // today looks the same as the one that was decided in June.
    case "rejected": return { label: "Rejected", tone: "mute" };
    case "pending_review":
    case "profile_review": return { label: "In review", tone: "warn" };
    case "pending_2nd_interview": return { label: "2nd interview", tone: "warn" };
    case "active": return { label: "Applying", tone: "mute" };
    default: return { label: admin_status || "unknown", tone: "mute" };
  }
}

export async function loadDirectory(
  population: Population,
  query: string,
  page: number
): Promise<DirectoryPage | null> {
  if (!(await assertStaff())) return null;

  const db = serviceClient();
  const q = safeSearch(query);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  if (population === "candidates") {
    let sel = db
      .from("candidates")
      .select("id, full_name, display_name, email, role_category, country, admin_status, created_at, profile_photo_url, ban_pending_review", { count: "exact" });
    if (q) sel = sel.or(`full_name.ilike.%${q}%,display_name.ilike.%${q}%,email.ilike.%${q}%`);
    const { data, count, error } = await sel.order("created_at", { ascending: false }).range(from, to);
    if (error || count === null) return null;

    return {
      rows: (data ?? []).map((c) => ({
        id: c.id,
        name: c.full_name || c.display_name || "—",
        email: c.email,
        photoUrl: c.profile_photo_url,
        meta: [c.role_category, c.country].filter(Boolean).join(" · ") || "—",
        status: candidateStatus(c.admin_status, Boolean(c.ban_pending_review)),
        joinedAt: c.created_at,
        href: `/admin/candidates/${c.id}`,
        hrefLabel: "Record",
        // The public page resolves only for approved candidates; for anyone
        // else it falls through to an owner-only view and shows nothing. The
        // admin record above works for every candidate regardless.
        publicHref: isLive(c.admin_status) ? `/candidate/${c.id}` : null,
      })),
      total: count,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  if (population === "clients") {
    let sel = db.from("clients").select("id, full_name, email, company_name, created_at", { count: "exact" });
    if (q) sel = sel.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,company_name.ilike.%${q}%`);
    const { data, count, error } = await sel.order("created_at", { ascending: false }).range(from, to);
    if (error || count === null) return null;

    return {
      rows: (data ?? []).map((c) => ({
        id: c.id,
        name: c.full_name || "—",
        email: c.email,
        photoUrl: null,
        meta: c.company_name || "—",
        // `clients` carries no status column. Rather than colour a made-up
        // one, the row says what it knows: this is a client account.
        status: { label: "Client", tone: "mute" as const },
        joinedAt: c.created_at,
        href: `/admin/clients/${c.id}`,
        hrefLabel: "Record",
        publicHref: null,
      })),
      total: count,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  const roles = population === "specialists" ? ["recruiter"] : ["admin", "recruiting_manager"];
  let sel = db
    .from("profiles")
    .select("id, full_name, email, role, is_active, suspended_at, created_at, recruiter_photo_url", { count: "exact" })
    .in("role", roles);
  if (q) sel = sel.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
  const { data, count, error } = await sel.order("created_at", { ascending: false }).range(from, to);
  if (error || count === null) return null;

  const ROLE_TEXT: Record<string, string> = {
    recruiter: "Talent specialist",
    admin: "Administrator",
    recruiting_manager: "Recruiting manager",
  };

  return {
    rows: (data ?? []).map((p) => ({
      id: p.id,
      name: p.full_name || "—",
      email: p.email,
      photoUrl: p.recruiter_photo_url,
      meta: ROLE_TEXT[p.role] ?? p.role,
      status: p.suspended_at
        ? { label: "Suspended", tone: "bad" as const }
        : p.is_active
          ? { label: "Active", tone: "ok" as const }
          : { label: "Inactive", tone: "warn" as const },
      joinedAt: p.created_at,
      // Specialists and managers both have a record; the staff page is a
      // roster, so admins-and-managers rows still point at the list.
      href: population === "specialists" ? `/admin/recruiters/${p.id}` : "/admin/staff",
      hrefLabel: population === "specialists" ? "Record" : "Managers & admins",
      publicHref: null,
    })),
    total: count,
    page,
    pageSize: PAGE_SIZE,
  };
}
