import Link from "next/link";
import type { VisibilityReason } from "@/lib/candidateVisibility";

/**
 * The empty state, which is the default state.
 *
 * Zero jobs pass job_is_open() and zero offers are pending, for all 31 live
 * candidates, and that stays true until a client posts. So this is the primary
 * screen rather than a fallback, and it is written to be true on the day the
 * marketplace is quiet — which is every day so far.
 *
 * Deliberately absent, because the data contradicts each one: "we'll email you
 * when a role matches" (candidate mail is frozen), "new roles are posted daily"
 * (one post in five months), "check back soon" (nothing is scheduled to
 * arrive), any count, and any match percentage.
 */
export default function WorkEmpty({
  matchable,
  reason,
}: {
  matchable: boolean;
  /** When not matchable, the reason computeVisibility() already gave. */
  reason?: VisibilityReason;
}) {
  // Not being matched is a different sentence from nothing being available, and
  // conflating them would tell someone on an active contract that no work
  // exists. The reason text is inherited verbatim rather than re-derived, so
  // this cannot contradict the status banner on the dashboard.
  if (!matchable) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-base font-semibold text-[#1C1B1A]">
          {reason?.title ?? "You're not being matched to new roles."}
        </h2>
        {reason?.detail && (
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-gray-600">{reason.detail}</p>
        )}
        {reason?.action && (
          <Link
            href={reason.action.href}
            className="mt-3 inline-block text-sm font-semibold text-[#FE6E3E] hover:underline"
          >
            {reason.action.label} →
          </Link>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="text-base font-semibold text-[#1C1B1A]">No open roles right now.</h2>
      <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-gray-600">
        On StaffVA most work comes to you directly: clients search the
        marketplace and send you an offer. Roles that clients post for your
        skills also show up here.
      </p>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-600">
        {/* Both levers are causally true, not filler: job_skill_or_role_match()
            keys on role_category and skills, and job_start_ok() on availability
            — and all three are writable by the candidate today. */}
        Two things put you in front of more clients — your availability, and how
        fully your profile describes what you do.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href="/candidate/dashboard#availability"
          className="rounded-full border border-gray-300 px-5 py-2 text-sm font-semibold text-[#1C1B1A] transition-colors hover:border-[#1C1B1A]"
        >
          Update availability
        </Link>
        <Link
          href="/candidate/profile/edit"
          className="rounded-full border border-gray-300 px-5 py-2 text-sm font-semibold text-[#1C1B1A] transition-colors hover:border-[#1C1B1A]"
        >
          Edit my profile
        </Link>
      </div>
    </section>
  );
}
