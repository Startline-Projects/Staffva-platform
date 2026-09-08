import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import ShortlistsView, { type ShortlistWithPeople, type SavedSearchRow } from "@/components/client/portal/ShortlistsView";
import { computeVisibility, marketAvailability } from "@/lib/candidateVisibility";
import { countMatches, describeFilters, filtersToQuery, type SavedSearchFilters } from "@/lib/savedSearch";

/**
 * My Shortlists (Atlas step 8) — the saved lists and saved searches.
 *
 * Two things this page refuses to do:
 *
 * 1. Show a saved candidate as if nothing has changed. Someone shortlisted in
 *    March may since have been blocked, un-approved, or gone unavailable.
 *    Their row says so instead of linking to a profile that will 404 or to a
 *    person who cannot be hired — a shortlist is a list a client acts on.
 *
 * 2. Print a saved-search count that was true once. Counts are computed at
 *    render through the same RPC /browse pages against.
 *
 * No share links, per the owner's D6.
 */
export const dynamic = "force-dynamic";

export default async function ShortlistsPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/shortlists");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: client } = await admin
    .from("clients")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!client) redirect("/team");

  // Migration 00233 creates these tables. Until it is applied the reads fail,
  // and a 500 here would be a rail row that leads to a crash — so it degrades
  // to a plain "not available yet" instead, the same position /verify takes
  // about 00231.
  const { data: listRows, error: listErr } = await admin
    .from("client_shortlists")
    .select("id, name, is_default, created_at, client_shortlist_members(candidate_id, added_at)")
    .eq("client_id", client.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  const { data: searchRows, error: searchErr } = await admin
    .from("client_saved_searches")
    .select("id, name, filters, notify, last_seen_count, created_at")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false });

  if (listErr || searchErr) {
    return (
      <section className="sl">
        <h1 className="sl-title">My Shortlists</h1>
        <p className="sl-lead">
          Saved lists aren&apos;t available yet. Nothing you saved is lost — try again
          shortly, or email <a href="mailto:support@staffva.com">support@staffva.com</a> if
          it keeps happening.
        </p>
      </section>
    );
  }

  // One read for every saved candidate across every list, rather than one per
  // list — the same person is often on several.
  const allIds = Array.from(
    new Set(
      (listRows || []).flatMap((l) =>
        ((l.client_shortlist_members as { candidate_id: string }[] | null) || []).map((m) => m.candidate_id)
      )
    )
  );

  const people = new Map<string, ShortlistWithPeople["people"][number]>();
  if (allIds.length > 0) {
    const { data: cands } = await admin
      .from("candidates")
      .select(
        "id, display_name, role_category, tagline, country, hourly_rate, profile_photo_url, english_written_tier, availability_status, availability_date, availability_last_updated_at, admin_status, permanently_blocked, id_verification_status, id_verification_due_at, lock_status, created_at"
      )
      .in("id", allIds);

    for (const c of cands || []) {
      const vis = computeVisibility(c);
      // "Not currently available" flattened three different things into one
      // soft sentence — a closed account read like a scheduling matter. Each
      // gets its own, and each is derived from the column that caused it.
      const withdrawn = c.permanently_blocked
        ? "This account has been closed."
        : c.admin_status !== "approved"
          ? "No longer listed on StaffVA."
          : !vis.searchable
            ? "Temporarily hidden from search."
            : null;

      people.set(c.id, {
        id: c.id,
        name: c.display_name || "Candidate",
        withdrawn,
        // Everything below is directory data. For someone the marketplace has
        // withdrawn it is NOT sent to the browser at all — a blocked or
        // unlisted candidate's photo, rate, country and English tier stayed
        // visible to every client who ever hearted them, indefinitely. The
        // name stays so the row is still a usable record of who was saved.
        role: withdrawn ? "" : c.tagline || c.role_category || "",
        country: withdrawn ? "" : c.country || "",
        rate: withdrawn ? 0 : Number(c.hourly_rate) || 0,
        photo: withdrawn ? null : c.profile_photo_url,
        tier: withdrawn ? null : c.english_written_tier,
        availability: withdrawn ? "" : marketAvailability(c).label,
      });
    }
  }

  const shortlists: ShortlistWithPeople[] = (listRows || []).map((l) => {
    const members = ((l.client_shortlist_members as { candidate_id: string; added_at: string }[] | null) || [])
      .slice()
      .sort((a, b) => (a.added_at < b.added_at ? 1 : -1));
    return {
      id: l.id,
      name: l.name,
      isDefault: l.is_default,
      people: members
        .map((m) => people.get(m.candidate_id))
        // A member whose candidate row is gone (deleted account) drops out —
        // the count below counts what is rendered, not what is stored.
        .filter((p): p is ShortlistWithPeople["people"][number] => Boolean(p)),
    };
  });

  // Distinct PEOPLE, not memberships. Summing list lengths reported "4 people
  // across 2 lists" for three people, one of whom was in both — a number the
  // lists immediately below it contradict.
  const distinctSaved = new Set(
    shortlists.flatMap((l) => l.people.map((p) => p.id))
  ).size;

  const searches: SavedSearchRow[] = [];
  for (const s of searchRows || []) {
    const filters = (s.filters || {}) as SavedSearchFilters;
    const count = await countMatches(admin, filters);
    searches.push({
      id: s.id,
      name: s.name,
      summary: describeFilters(filters),
      href: `/browse${filtersToQuery(filters) ? `?${filtersToQuery(filters)}` : ""}`,
      notify: s.notify as "off" | "daily" | "weekly",
      // -1 means the count query failed; the view says so in words rather
      // than printing a zero it cannot stand behind.
      count,
      newSince: count < 0 ? 0 : Math.max(0, count - (s.last_seen_count ?? 0)),
    });
  }

  return <ShortlistsView shortlists={shortlists} searches={searches} distinctSaved={distinctSaved} />;
}
