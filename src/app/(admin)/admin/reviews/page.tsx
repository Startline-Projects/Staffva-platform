import { applyReviewFilter, loadReviews, type ReviewFilter } from "@/lib/adminReviews";
import ReviewListView from "@/components/admin/ReviewListView";

export const dynamic = "force-dynamic";

const FILTERS: ReviewFilter[] = ["all", "about_candidates", "about_clients", "sealed", "taken_down"];

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const sp = await searchParams;
  const filter: ReviewFilter = FILTERS.includes(sp.show as ReviewFilter) ? (sp.show as ReviewFilter) : "all";

  const page = await loadReviews();

  // null is a failed read. An empty platform is `counts.all === 0`, which the
  // view explains. The two must not look the same.
  if (!page) {
    return (
      <div className="adm-state error" role="alert">
        <strong>Reviews could not be read.</strong>
        <p style={{ marginTop: 8 }}>
          This is not an empty platform — there may be reviews, including taken-down ones, that this
          page cannot see. Reload; if it persists, check <code>SUPABASE_SERVICE_ROLE_KEY</code>.
        </p>
      </div>
    );
  }

  return <ReviewListView page={page} filter={filter} shown={applyReviewFilter(page.reviews, filter)} />;
}
