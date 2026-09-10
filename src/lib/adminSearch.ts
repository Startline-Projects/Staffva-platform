import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { safeSearch } from "@/lib/adminUsers";

/**
 * One search box over everything.
 *
 * `/admin/users` searches people within a chosen population; this does not ask
 * you to choose. It also resolves a bare id: an admin who has a uuid from a
 * log line or a URL wants the record, not a list, and pasting one here now
 * lands on it.
 *
 * The `or()` filter is built from user text, so it goes through the same
 * `safeSearch` guard the directory uses — PostgREST parses commas and
 * parentheses as filter syntax, and there is exactly one definition of that
 * escaping for both callers.
 *
 * Server-only: reads SUPABASE_SERVICE_ROLE_KEY.
 */

export type ResultKind = "candidate" | "client" | "specialist" | "staff" | "job" | "engagement" | "review" | "dispute";

export interface SearchHit {
  kind: ResultKind;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  /** Set when the query was an exact id for this row. */
  exactId?: boolean;
}

export interface SearchResults {
  query: string;
  /** Present when the query looked like a uuid and resolved to exactly one row. */
  jumpTo: SearchHit | null;
  groups: { kind: ResultKind; label: string; hits: SearchHit[] }[];
  total: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KIND_LABEL: Record<ResultKind, string> = {
  candidate: "Candidates",
  client: "Clients",
  specialist: "Talent specialists",
  staff: "Managers & admins",
  job: "Job postings",
  engagement: "Engagements",
  review: "Reviews",
  dispute: "Disputes",
};

const PER_KIND = 8;

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function assertStaff() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  return Boolean(user) && (role === "admin" || role === "recruiting_manager");
}

/** null means the read failed — never "nothing matched". */
export async function search(rawQuery: string): Promise<SearchResults | null> {
  if (!(await assertStaff())) return null;

  const query = rawQuery.trim();
  if (!query) return { query, jumpTo: null, groups: [], total: 0 };

  const db = serviceClient();

  // ── An id is a request for one record, not a search ──
  if (UUID.test(query)) {
    const jump = await resolveId(db, query);
    if (jump) return { query, jumpTo: jump, groups: [{ kind: jump.kind, label: KIND_LABEL[jump.kind], hits: [jump] }], total: 1 };
    // A well-formed uuid that matches nothing is worth saying out loud rather
    // than falling through to a text search that will also find nothing.
    return { query, jumpTo: null, groups: [], total: 0 };
  }

  const q = safeSearch(query);
  if (!q) return { query, jumpTo: null, groups: [], total: 0 };

  const [cands, clients, staff, jobs] = await Promise.all([
    db.from("candidates")
      .select("id, full_name, display_name, email, role_category, country, admin_status")
      .or(`full_name.ilike.%${q}%,display_name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(PER_KIND),
    db.from("clients")
      .select("id, full_name, email, company_name")
      .or(`full_name.ilike.%${q}%,email.ilike.%${q}%,company_name.ilike.%${q}%`)
      .limit(PER_KIND),
    db.from("profiles")
      .select("id, full_name, email, role")
      .in("role", ["recruiter", "recruiting_manager", "admin"])
      .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(PER_KIND),
    db.from("job_posts")
      .select("id, title, role_category, status")
      .or(`title.ilike.%${q}%,role_category.ilike.%${q}%`)
      .limit(PER_KIND),
  ]);

  const groups: SearchResults["groups"] = [];

  const push = (kind: ResultKind, hits: SearchHit[]) => {
    if (hits.length) groups.push({ kind, label: KIND_LABEL[kind], hits });
  };

  push("candidate", (cands.data ?? []).map((c) => ({
    kind: "candidate" as const,
    id: c.id,
    title: c.full_name || c.display_name || "—",
    subtitle: [c.email, c.role_category, c.country].filter(Boolean).join(" · ") || null,
    href: `/admin/candidates/${c.id}`,
  })));

  push("client", (clients.data ?? []).map((c) => ({
    kind: "client" as const,
    id: c.id,
    title: c.full_name || c.company_name || "—",
    subtitle: [c.email, c.company_name].filter(Boolean).join(" · ") || null,
    href: `/admin/clients/${c.id}`,
  })));

  // Specialists get their own record; admins and managers only have the roster.
  const specialists = (staff.data ?? []).filter((p) => p.role !== "admin");
  const admins = (staff.data ?? []).filter((p) => p.role === "admin");

  push("specialist", specialists.map((p) => ({
    kind: "specialist" as const,
    id: p.id,
    title: p.full_name || p.email,
    subtitle: `${p.email} · ${p.role === "recruiting_manager" ? "recruiting manager" : "talent specialist"}`,
    href: `/admin/recruiters/${p.id}`,
  })));

  push("staff", admins.map((p) => ({
    kind: "staff" as const,
    id: p.id,
    title: p.full_name || p.email,
    subtitle: `${p.email} · administrator`,
    href: "/admin/staff",
  })));

  push("job", (jobs.data ?? []).map((j) => ({
    kind: "job" as const,
    id: j.id,
    title: j.title || "untitled posting",
    subtitle: [j.role_category, j.status].filter(Boolean).join(" · ") || null,
    href: `/admin/jobs/${j.id}`,
  })));

  return { query, jumpTo: null, groups, total: groups.reduce((s, g) => s + g.hits.length, 0) };
}

/** Try each table that has a record page, in the order an id is likeliest. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveId(db: any, id: string): Promise<SearchHit | null> {
  const { data: cand } = await db.from("candidates").select("id, full_name, display_name, email").eq("id", id).maybeSingle();
  if (cand) {
    return { kind: "candidate", id, exactId: true, title: cand.full_name || cand.display_name || "—", subtitle: cand.email, href: `/admin/candidates/${id}` };
  }

  const { data: client } = await db.from("clients").select("id, full_name, company_name, email").eq("id", id).maybeSingle();
  if (client) {
    return { kind: "client", id, exactId: true, title: client.full_name || client.company_name || "—", subtitle: client.email, href: `/admin/clients/${id}` };
  }

  const { data: eng } = await db.from("engagements").select("id, status, contract_type").eq("id", id).maybeSingle();
  if (eng) {
    return { kind: "engagement", id, exactId: true, title: "Engagement", subtitle: `${eng.contract_type} · ${eng.status}`, href: `/admin/engagements/${id}` };
  }

  const { data: job } = await db.from("job_posts").select("id, title, status").eq("id", id).maybeSingle();
  if (job) {
    return { kind: "job", id, exactId: true, title: job.title || "untitled posting", subtitle: job.status, href: `/admin/jobs/${id}` };
  }

  const { data: person } = await db.from("profiles").select("id, full_name, email, role").eq("id", id).maybeSingle();
  if (person) {
    const isSpecialist = person.role === "recruiter" || person.role === "recruiting_manager";
    return {
      kind: isSpecialist ? "specialist" : "staff",
      id,
      exactId: true,
      title: person.full_name || person.email,
      subtitle: `${person.email} · ${person.role}`,
      href: isSpecialist ? `/admin/recruiters/${id}` : "/admin/staff",
    };
  }

  // Reviews and disputes have no record page of their own — the list is the
  // page — so an id belonging to one lands on the list rather than nowhere.
  const { data: review } = await db.from("reviews").select("id, direction").eq("id", id).maybeSingle();
  if (review) {
    return { kind: "review", id, exactId: true, title: "Review", subtitle: review.direction, href: "/admin/reviews" };
  }

  const { data: dispute } = await db.from("disputes").select("id, resolved_at").eq("id", id).maybeSingle();
  if (dispute) {
    return { kind: "dispute", id, exactId: true, title: "Dispute", subtitle: dispute.resolved_at ? "resolved" : "open", href: dispute.resolved_at ? "/admin/disputes?status=resolved" : "/admin/disputes" };
  }

  return null;
}
