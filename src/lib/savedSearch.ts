import type { SupabaseClient } from "@supabase/supabase-js";
import { rolePatternsFor } from "@/lib/roleTaxonomy";

/**
 * The filter set a saved search stores, and how it is counted.
 *
 * The count goes through get_candidates_with_skills — the SAME RPC /browse
 * pages against — and reads its `total`. That is deliberate: step 6's facet
 * counts were reimplemented in TypeScript and drifted from the query they
 * described (exact vs substring role matching, skills that ignored `tools`,
 * NULL rates counted as $0), so a sidebar could say 0 beside eight visible
 * cards. A saved search that promises "12 match" must mean the twelve the
 * client would actually see, so it asks the thing that decides.
 *
 * Page size 1 because only the total is wanted; the RPC computes the count
 * over the filtered set regardless of the page.
 */

export interface SavedSearchFilters {
  search?: string | null;
  role?: string | null;
  country?: string | null;
  minRate?: number | null;
  maxRate?: number | null;
  availability?: string | null;
  tier?: string | null;
  usExperience?: string | null;
  skills?: string[] | null;
}

/** The querystring that reproduces this search on /browse. */
export function filtersToQuery(f: SavedSearchFilters): string {
  const p = new URLSearchParams();
  if (f.search) p.set("search", f.search);
  if (f.role && f.role !== "All") p.set("role", f.role);
  if (f.country) p.set("country", f.country);
  if (f.minRate) p.set("minRate", String(f.minRate));
  if (f.maxRate && f.maxRate < 150) p.set("maxRate", String(f.maxRate));
  if (f.availability) p.set("availability", f.availability);
  if (f.tier && f.tier !== "any") p.set("tier", f.tier);
  if (f.usExperience) p.set("usExperience", f.usExperience);
  if (f.skills && f.skills.length > 0) p.set("skills", f.skills.join(","));
  return p.toString();
}

/** A short human summary of the filters, for the saved-search card. */
export function describeFilters(f: SavedSearchFilters): string {
  const parts: string[] = [];
  if (f.role && f.role !== "All") parts.push(f.role);
  if (f.search) parts.push(`“${f.search}”`);
  if (f.country) parts.push(f.country);
  if (f.skills && f.skills.length > 0) parts.push(f.skills.slice(0, 3).join(", "));
  if (f.minRate || (f.maxRate && f.maxRate < 150)) {
    const lo = f.minRate ? `$${f.minRate}` : "$0";
    const hi = f.maxRate && f.maxRate < 150 ? `$${f.maxRate}` : "any";
    parts.push(`${lo}–${hi}/hr`);
  }
  if (f.availability === "available") parts.push("available now");
  if (f.availability === "partially_available") parts.push("available from a date");
  if (f.tier && f.tier !== "any") parts.push(`English: ${f.tier}`);
  if (f.usExperience === "yes") parts.push("US experience");
  if (f.usExperience === "no") parts.push("no US experience");
  return parts.length > 0 ? parts.join(" · ") : "Everyone";
}

export async function countMatches(
  admin: SupabaseClient,
  f: SavedSearchFilters
): Promise<number> {
  const { data, error } = await admin.rpc("get_candidates_with_skills", {
    p_search: f.search || null,
    p_roles: f.role && f.role !== "All" ? rolePatternsFor(f.role) : null,
    p_country: f.country || null,
    p_min_rate: f.minRate ?? null,
    p_max_rate: f.maxRate && f.maxRate < 150 ? f.maxRate : null,
    p_availability: f.availability || null,
    p_tier: f.tier && f.tier !== "any" ? f.tier : null,
    p_us_experience: f.usExperience || null,
    p_skills: f.skills && f.skills.length > 0 ? f.skills : null,
    p_sort: "complete",
    p_page: 1,
    p_page_size: 1,
  });
  if (error) {
    // Caller renders "—" rather than a zero it cannot stand behind: "0 match"
    // and "we could not count" are different sentences.
    console.error("[savedSearch] count failed:", error.message);
    return -1;
  }
  return Number(data?.total ?? 0);
}
