import AdminReviewList from "@/components/admin/AdminReviewList";

/**
 * Every review on the platform, and the control that takes one down.
 *
 * The reason this page exists at all: `reviews.published` shipped as a column
 * with no writer and no reader. A forged, abusive, or simply mistaken review
 * would have attached itself permanently to a real person's ability to get
 * hired, with no path to removal short of a hand-written SQL statement.
 */
export default function AdminReviewsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Reviews</h1>
      <p style={{ fontSize: 13, color: "#6B6862", marginBottom: 18, maxWidth: 640 }}>
        Both directions of every review pair. Unrevealed reviews are listed here
        and nowhere else — staff can see a sealed review, the other party cannot.
        Taking one down hides it from the public profile and removes it from the
        candidate&apos;s reputation score; nothing is deleted.
      </p>
      <AdminReviewList />
    </div>
  );
}
