import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { loadMyReviewState } from "@/lib/reviewState";
import ClientReviews from "@/components/client/portal/ClientReviews";

/**
 * Reviews (Atlas step 19), inside the client portal.
 *
 * No new backend. Two-sided sealed reviews shipped for the candidate side in
 * migrations 00196–00201, and my_review_state() is already SYMMETRIC — it
 * resolves auth.uid() to 'client' or 'candidate' itself and returns both
 * halves of the pair from the caller's point of view. So this page reads the
 * same function the candidate's does, and the two cannot disagree about
 * whether a review is open, submitted, sealed or published.
 *
 * The write path is the shared <ReviewExchange>, unchanged. A client-only
 * copy of it is exactly how a "two-sided" system quietly becomes one-sided.
 */
export default async function ClientReviewsPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/reviews");

  // Filtered to the rows where this person is the CLIENT. my_review_state()
  // returns every engagement they are a party to, and a StaffVA account can
  // hold both a clients row and a candidates row — without this filter the
  // client portal would render their candidate-side reviews with the roles
  // reversed.
  const states = (await loadMyReviewState()).filter((s) => s.your_role === "client");

  return <ClientReviews states={states} />;
}
