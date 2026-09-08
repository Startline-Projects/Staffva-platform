import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rolePatternsFor, BROWSE_PILLS } from "@/lib/roleTaxonomy";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Facet counts for browse.
 *
 * Atlas's sidebar shows a number beside every filter — "Bookkeeper 312",
 * "Philippines 812", "QuickBooks 218". All 40-odd of them are hard-coded, and
 * they do not add up to its own claimed pool. These are counted.
 *
 * They are counted the way facets are supposed to be: each dimension's counts
 * apply every OTHER active filter but not its own. Picking "Philippines"
 * should not collapse the country list to a single row — you still need to
 * see what switching to Mexico would give you. Doing that in SQL is one query
 * per dimension; the visible pool is small enough to do it in one query and
 * count in memory instead.
 *
 * The base predicate is copied from get_candidates_with_skills (00219) and
 * must stay in step with it: approved, not blocked, and inside the 14-day ID
 * window. If those diverge, this route reports counts for a pool the results
 * list does not have.
 *
 * There is deliberately NO "screened only" facet, though it is the one a
 * client would most want today (30 of the pool have passed a skills
 * interview, the rest have not attempted one). The results query cannot
 * filter on it — that lives inside the RPC — and a checkbox that changes the
 * count but not the list is worse than its absence. The per-card badge
 * carries the fact until the RPC can carry the filter.
 */

const POOL_CAP = 5000;

interface Row {
  display_name: string | null;
  role_category: string | null;
  country: string | null;
  bio: string | null;
  hourly_rate: number | null;
  availability_status: string | null;
  english_written_tier: string | null;
  us_client_experience: string | null;
  skills: unknown;
  tools: unknown;
  /** skills ∪ tools, lowercased once per row instead of per predicate call. */
  _terms?: string[];
}

type Filters = {
  search: string | null;
  role: string | null;
  country: string | null;
  minRate: number | null;
  maxRate: number | null;
  availability: string | null;
  tier: string | null;
  usExperience: string | null;
  skills: string[];
};

const US_YES = new Set([
  "less_than_6_months",
  "6_months_to_1_year",
  "1_to_2_years",
  "2_to_5_years",
  "5_plus_years",
]);

/** ILIKE, faithfully: '%x%' is a substring test, anything else is exact. */
function matchesRole(stored: string | null, pill: string | null): boolean {
  if (!pill || pill === "All") return true;
  const role = (stored || "").toLowerCase();
  return rolePatternsFor(pill).some((pat) => {
    const p = pat.toLowerCase();
    return p.includes("%") ? role.includes(p.replace(/%/g, "")) : role === p;
  });
}

/** One predicate per dimension, so a dimension can exclude its own. */
const MATCHERS: Record<string, (r: Row, f: Filters) => boolean> = {
  // ILIKE semantics, not "contains". rolePatternsFor returns BARE role names
  // for a known pill — which SQL matches exactly — and only the unknown-value
  // fallback carries %wildcards%. Treating both as substring counted
  // "Paralegal (Immigration)" under the Paralegal pill that the results query
  // excludes, so the chip and the list disagreed.
  role: (r, f) => matchesRole(r.role_category, f.role),
  search: (r, f) => {
    if (!f.search) return true;
    const q = f.search.toLowerCase();
    return [r.display_name, r.role_category, r.country, r.bio].some((v) =>
      (v || "").toLowerCase().includes(q)
    );
  },
  country: (r, f) =>
    !f.country || (r.country || "").toLowerCase().includes(f.country.toLowerCase()),
  rate: (r, f) => {
    if (f.minRate == null && f.maxRate == null) return true;
    // A NULL rate fails every SQL comparison, so it is excluded the moment a
    // bound exists. Number(null) is 0, which quietly counted rate-less
    // candidates into every max-only filter.
    if (r.hourly_rate == null) return false;
    const rate = Number(r.hourly_rate);
    if (f.minRate != null && !(rate >= f.minRate)) return false;
    if (f.maxRate != null && !(rate <= f.maxRate)) return false;
    return true;
  },
  availability: (r, f) => {
    if (!f.availability) return true;
    if (f.availability === "available") return r.availability_status === "available_now";
    if (f.availability === "partially_available")
      return r.availability_status === "available_by_date";
    return true;
  },
  tier: (r, f) => !f.tier || f.tier === "any" || r.english_written_tier === f.tier,
  usExperience: (r, f) => {
    if (!f.usExperience) return true;
    const v = r.us_client_experience || "";
    return f.usExperience === "yes" ? US_YES.has(v) : v === "international_only" || v === "none";
  },
  // The RPC matches each requested term as a SUBSTRING against skills
  // CONCATENATED WITH tools, and requires all terms. Exact-equality over
  // skills alone missed a candidate whose "QuickBooks Online" lives in tools
  // — the list showed them, every sidebar count did not.
  skills: (r, f) => {
    if (f.skills.length === 0) return true;
    const terms = r._terms ?? [];
    return f.skills.every((req) => {
      const needle = req.toLowerCase();
      return terms.some((t) => t.includes(needle));
    });
  },
};

/** Every dimension except the named one. */
function matchesExcept(row: Row, filters: Filters, except: string | null): boolean {
  for (const [name, fn] of Object.entries(MATCHERS)) {
    if (name === except) continue;
    if (!fn(row, filters)) return false;
  }
  return true;
}

function tally<T extends string>(
  rows: Row[],
  filters: Filters,
  dimension: string,
  key: (r: Row) => T | null
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (!matchesExcept(r, filters, dimension)) continue;
    const k = key(r);
    if (k == null || k === "") continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filters: Filters = {
    search: searchParams.get("search"),
    role: searchParams.get("role"),
    country: searchParams.get("country"),
    minRate: searchParams.get("minRate") ? Number(searchParams.get("minRate")) : null,
    // Browse's slider tops out at 150 and treats that as "no ceiling".
    maxRate:
      searchParams.get("maxRate") && Number(searchParams.get("maxRate")) < 150
        ? Number(searchParams.get("maxRate"))
        : null,
    availability: searchParams.get("availability"),
    tier: searchParams.get("tier"),
    usExperience: searchParams.get("usExperience"),
    skills: (searchParams.get("skills") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };

  const admin = getAdminClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("candidates")
    .select(
      "display_name, role_category, country, bio, hourly_rate, availability_status, english_written_tier, us_client_experience, skills, tools"
    )
    .eq("admin_status", "approved")
    .eq("permanently_blocked", false)
    .or(
      `id_verification_status.eq.passed,id_verification_status.eq.manual_review,id_verification_due_at.is.null,id_verification_due_at.gte.${nowIso}`
    )
    // Deterministic, so two identical requests cannot disagree once the cap
    // starts biting.
    .order("id", { ascending: true })
    .limit(POOL_CAP);

  if (error) {
    // No invented zeroes: the caller renders the sidebar without counts
    // rather than showing "0" beside a facet that has people behind it.
    console.error("[facets] pool read failed:", error.message);
    return NextResponse.json({ error: "Could not compute facets" }, { status: 500 });
  }

  const rows = (data || []) as Row[];
  // Lowercased skills ∪ tools, once per row rather than once per predicate
  // call — the role tally alone runs the matchers 14 times per candidate.
  for (const r of rows) {
    const skills = Array.isArray(r.skills) ? (r.skills as unknown[]) : [];
    const tools = Array.isArray(r.tools) ? (r.tools as unknown[]) : [];
    r._terms = [...skills, ...tools].map((t) => String(t).toLowerCase());
  }

  const matchingAll = rows.filter((r) => matchesExcept(r, filters, null)).length;
  // What "All" means on the role rail: everything the OTHER filters allow.
  // poolTotal ignores them, so the All chip used to read 223 next to siblings
  // summing to 90.
  const matchingExceptRole = rows.filter((r) => matchesExcept(r, filters, "role")).length;

  // Role counts key on the browse pill vocabulary, not the raw stored role,
  // because that is what the sidebar offers. rolePatternsFor is the same
  // mapping the results query uses.
  const roleCounts: Record<string, number> = {};
  const roleEligible = rows.filter((r) => matchesExcept(r, filters, "role"));
  for (const pill of BROWSE_PILLS) {
    const n = roleEligible.filter((r) => matchesRole(r.role_category, pill.label)).length;
    if (n > 0) roleCounts[pill.label] = n;
  }

  return NextResponse.json({
    // The pool this page can show at all, before any filter — the honest
    // answer to "how many candidates are there".
    poolTotal: rows.length,
    poolCapped: rows.length >= POOL_CAP,
    matching: matchingAll,
    matchingExceptRole,
    // Does ANY visible candidate have a tier, ignoring current filters? The
    // cross-filtered tally cannot answer that: it empties whenever the
    // current filters happen to exclude everyone who has one.
    tiersExistInPool: rows.some((r) => !!r.english_written_tier),
    countries: Object.entries(tally(rows, filters, "country", (r) => r.country as string))
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count),
    roles: Object.entries(roleCounts)
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count),
    availability: tally(rows, filters, "availability", (r) => r.availability_status as string),
    tiers: tally(rows, filters, "tier", (r) => r.english_written_tier as string),
  });
}
