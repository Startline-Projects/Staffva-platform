import Link from "next/link";
import type { AdminReview, ReviewFilter, ReviewsPage } from "@/lib/adminReviews";
import ReviewTakedownButton from "@/components/admin/ReviewTakedownButton";

const fmtDate = (v: string) =>
  new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const FILTERS: { id: ReviewFilter; label: string; key: keyof ReviewsPage["counts"] }[] = [
  { id: "all", label: "All", key: "all" },
  { id: "about_candidates", label: "About candidates", key: "aboutCandidates" },
  { id: "about_clients", label: "About clients", key: "aboutClients" },
  { id: "sealed", label: "Still sealed", key: "sealed" },
  { id: "taken_down", label: "Taken down", key: "takenDown" },
];

function Stars({ rating }: { rating: number }) {
  return (
    <span className="rev-stars" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= rating ? "on" : ""} aria-hidden="true">★</span>
      ))}
    </span>
  );
}

function ReviewCard({ r }: { r: AdminReview }) {
  const aboutCandidate = r.direction === "client_to_candidate";

  const subject = aboutCandidate ? r.candidateName : r.clientName;
  const author = aboutCandidate ? r.clientName : r.candidateName;
  const subjectHref = aboutCandidate
    ? (r.candidateId ? `/admin/candidates/${r.candidateId}` : null)
    : (r.clientId ? `/admin/clients/${r.clientId}` : null);

  return (
    <div className="adm-panel rev-card">
      <div className="rev-head">
        <div style={{ minWidth: 0 }}>
          <div className="rev-subject">
            <span className="rev-about">{aboutCandidate ? "About candidate" : "About client"}</span>
            {subjectHref
              ? <Link href={subjectHref} className="row-link">{subject ?? "unknown"}</Link>
              : (subject ?? "unknown")}
          </div>
          <div className="rev-meta">
            written by {author ?? "unknown"} · submitted {fmtDate(r.submittedAt)} ·{" "}
            <Link href={`/admin/engagements/${r.engagementId}`} className="row-link">engagement</Link>
          </div>
        </div>
        <Stars rating={r.rating} />
        {r.sealed && <span className="adm-pill mute">sealed until {fmtDate(r.revealAt)}</span>}
        {!r.published && <span className="adm-pill bad">taken down</span>}
      </div>

      <div className="rev-body">
        {r.body ? <div className="rec-prose">{r.body}</div> : <div className="rec-v empty">rating only, no written review</div>}
      </div>

      <div className="rev-foot">
        <span className="rev-reach">
          {aboutCandidate
            ? r.published
              ? "On the candidate's public profile and in their public rating."
              : "Hidden from the public profile and excluded from their public rating."
            : r.published
              ? "Visible to the client. Client reviews are private either way — they are never public."
              : "Hidden from the client."}
        </span>
        <ReviewTakedownButton reviewId={r.id} published={r.published} aboutCandidate={aboutCandidate} />
      </div>
    </div>
  );
}

export default function ReviewListView({
  page,
  filter,
  shown,
}: {
  page: ReviewsPage;
  filter: ReviewFilter;
  shown: AdminReview[];
}) {
  const { counts } = page;

  return (
    <div className="adm-col" style={{ maxWidth: 1000 }}>
      <div className="adm-page-header">
        <div>
          <div className="adm-eyebrow">Operations</div>
          <h1>What people said <span className="adm-serif-italic">about each other.</span></h1>
          <div className="adm-subhead">
            <strong>{counts.all}</strong> {counts.all === 1 ? "review" : "reviews"}
            <span className="sep">·</span>
            {counts.aboutCandidates} about candidates
            <span className="sep">·</span>
            {counts.aboutClients} about clients
          </div>
        </div>
      </div>

      <p className="staff-legend">
        Both directions of every review, including ones that have not revealed yet and ones already
        taken down — the two published views hide exactly those. Taking a review down is not
        symmetric: a candidate review sits on a public profile and counts toward that
        candidate&apos;s public rating, while a client review is private to that client whether it is
        published or not. Nothing here deletes anything.
      </p>

      {counts.all > 0 && (
        <div className="alerts-filter-row" role="tablist" aria-label="Filter reviews" style={{ marginBottom: 18 }}>
          {FILTERS.map((f) => (
            <Link
              key={f.id}
              href={f.id === "all" ? "/admin/reviews" : `/admin/reviews?show=${f.id}`}
              role="tab"
              aria-selected={filter === f.id}
              className={`alerts-filter${filter === f.id ? " active" : ""}`}
            >
              {f.label}
              <span className="filter-count">{counts[f.key]}</span>
            </Link>
          ))}
        </div>
      )}

      {counts.all === 0 ? (
        <div className="adm-state">
          No review has ever been submitted. The window opens on an engagement only once a payment
          on it has actually been released, and nothing on this platform has released yet — so this
          is a consequence of the escrow being untouched, not a moderation backlog.
        </div>
      ) : shown.length === 0 ? (
        <div className="adm-state">No review matches that filter.</div>
      ) : (
        <div className="alerts-list">
          {shown.map((r) => <ReviewCard key={r.id} r={r} />)}
        </div>
      )}
    </div>
  );
}
