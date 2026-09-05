import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import WorkReviews from "@/components/candidate/WorkReviews";
import { loadMyReviewState } from "@/lib/reviewState";

/**
 * The Reviews tab of the Atlas shell: both halves of every review pair on the
 * engagements this candidate has been paid on. The exchange component is the
 * same one the client's dashboard renders — a review system where one side is
 * asked warmly and the other in a footnote is not two-sided in any way that
 * matters.
 *
 * Empty for everyone today, honestly: eligibility is released money, and no
 * engagement has released any.
 */
export default async function CandidateReviewsPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/candidate/reviews");
  if (user.app_metadata?.role !== "candidate") redirect("/dashboard");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: candidate, error } = await admin
    .from("candidates")
    .select("id, admin_status")
    .eq("user_id", user.id)
    .maybeSingle();
  // A transient DB failure must not masquerade as "not allowed here" — the
  // same fail-loud contract every sibling portal page keeps.
  if (error) throw new Error(`reviews candidate lookup failed: ${error.message}`);
  if (!candidate) redirect("/candidate/dashboard");
  // Reviews attach to paid work, which is a post-approval concept.
  if (candidate.admin_status !== "approved") redirect("/candidate/dashboard");

  const states = await loadMyReviewState();
  const eligible = states.filter((s) => s.window_opened_at !== null);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[#1C1B1A]">Reviews</h1>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-gray-600">
          You and your clients review each other after money has actually moved
          on an engagement. Both reviews stay sealed until each side has
          submitted, or 30 days pass — whichever comes first.
        </p>
      </div>

      {eligible.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-[#1C1B1A]">No reviews yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-600">
            Reviews open on an engagement once its first payment has been
            released. When that happens, this is where you&apos;ll write yours
            and read theirs.
          </p>
        </div>
      ) : (
        <WorkReviews states={states} />
      )}
    </div>
  );
}
