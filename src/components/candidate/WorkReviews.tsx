"use client";

import { useRouter } from "next/navigation";
import ReviewExchange from "@/components/reviews/ReviewExchange";
import { blockReasonFor, type ReviewState } from "@/lib/reviewEligibility";

/**
 * "Work you've finished" — the candidate's half of the review exchange.
 *
 * Same component the client's dashboard renders, on purpose. Reputation on
 * this platform is one-directional today: 256 candidates carry a score built
 * from client ratings, and no client carries anything. Giving the candidate a
 * cosmetically different, quieter version of the same screen would keep that
 * asymmetry while appearing to fix it.
 *
 * Engagements with no released payment are dropped rather than shown with a
 * "not yet" note. On the client's dashboard that note explains a card they are
 * already looking at; here it would be the entire section, and a heading that
 * says "work you've finished" over a list of things nobody can act on is worse
 * than no heading.
 */
export default function WorkReviews({ states }: { states: ReviewState[] }) {
  const router = useRouter();
  const actionable = states.filter((s) => s.window_opened_at !== null);
  if (actionable.length === 0) return null;

  const open = actionable.filter((s) => blockReasonFor(s) === null).length;

  return (
    <section className="mt-8">
      {/* Not "work you've finished": the window opens on the first released
          payment, so a monthly placement still running appears here in month
          one. Telling someone their live engagement has ended is worse than a
          duller heading. */}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
        Clients you&apos;ve worked with
      </h2>
      <p className="mt-1 text-sm text-gray-600">
        {open > 0
          ? "Say how it went. Your review and theirs stay sealed until you've both submitted, or 30 days pass."
          : "Reviews from the engagements you've been paid on."}
      </p>
      <div className="mt-4 space-y-4">
        {actionable.map((s) => (
          <div key={s.engagement_id} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm font-semibold text-[#1C1B1A]">{s.counterparty}</p>
            <div className="mt-3">
              <ReviewExchange state={s} onChange={() => router.refresh()} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
