import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import { computeVisibility } from "@/lib/candidateVisibility";
import { loadCandidateWork } from "@/lib/candidateWork";
import WorkOffers from "@/components/candidate/WorkOffers";
import OpenRoles from "@/components/candidate/OpenRoles";
import WorkEmpty from "@/components/candidate/WorkEmpty";
import WorkReviews from "@/components/candidate/WorkReviews";
import { loadMyReviewState } from "@/lib/reviewState";

/**
 * Work available to this candidate: offers sent to them, and roles they match.
 *
 * The reason this page exists is narrower than "a jobs view". An offer sent
 * today reaches the candidate through nothing: the only in-product link to
 * /offers/[id] lived in an email, and candidate mail is frozen until the owner
 * lifts it. So the delivery surface is the deliverable; the role list is wired
 * correctly behind it and is honestly empty.
 *
 * Note for anyone extending this: engagement_offers holds ONE row against eight
 * engagements, with no column linking them, and is_direct_contract is false on
 * all eight — so they were not direct contracts either, and which flow created
 * them is not recorded.
 *
 * Everything is read through the service role via loadCandidateWork() — the
 * same loader the dashboard entry point uses, so the two cannot disagree about
 * whether an offer is waiting.
 */
export default async function CandidateWorkPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/candidate/work");
  if (user.app_metadata?.role !== "candidate") redirect("/dashboard");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: candidate, error } = await admin
    .from("candidates")
    .select(
      "id, first_name, display_name, full_name, admin_status, permanently_blocked, id_verification_status, id_verification_due_at, availability_status, availability_last_updated_at, created_at, lock_status"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new Error(`candidate lookup failed: ${error.message}`);
  if (!candidate) redirect("/candidate/dashboard");

  // Work is a post-approval concept. An applicant landing here must not read
  // "no roles available" as a verdict on their application.
  if (candidate.admin_status !== "approved") redirect("/candidate/dashboard");

  const vis = computeVisibility(candidate);
  const { offers, roles, engagementCount } = await loadCandidateWork(candidate.id);
  const reviewStates = await loadMyReviewState();

  const firstName =
    candidate.first_name ||
    (candidate.display_name || candidate.full_name || "there").split(" ")[0];

  // The reason the candidate is out of matching, taken from computeVisibility
  // rather than re-derived, so this page cannot contradict the dashboard.
  const blockReason = vis.reasons.find(
    (r) => r.kind === "not_in_matches" || r.kind === "on_contract" || r.hidesFromSearch
  );

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-[#1C1B1A]">Your work</h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-gray-600">
            Offers clients have sent you, and roles they&apos;ve posted that match
            your skills.
          </p>
        </div>

        <WorkOffers offers={offers} />
        <OpenRoles roles={roles} />

        {/* One condition: whenever there are no roles. It reads the same
            whether or not an offer is present, and it takes its wording from
            computeVisibility() — so a candidate who is out of matching is never
            told that roles will start appearing for them. */}
        {roles.length === 0 && <WorkEmpty matchable={vis.matchable} reason={blockReason} />}

        <WorkReviews states={reviewStates} />

        {/* Contracts already have a home on the dashboard. Two homes for one
            thing is the drift this codebase keeps paying for, so this is a
            pointer, and only when there is something to point at. */}
        {engagementCount > 0 && (
          <p className="mt-6 text-sm text-gray-500">
            Work you&apos;ve already signed for is on your{" "}
            <Link href="/candidate/dashboard" className="font-semibold text-[#FE6E3E] hover:underline">
              dashboard
            </Link>
            .
          </p>
        )}

        <p className="mt-8 text-xs text-gray-400">
          Signed in as {firstName}.{" "}
          <Link href="/candidate/dashboard" className="hover:underline">
            Back to dashboard
          </Link>
        </p>
      </div>
    </>
  );
}
