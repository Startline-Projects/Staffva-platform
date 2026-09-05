import Link from "next/link";
import { computeVisibility, availabilityIsStale, type VisibilityInput } from "@/lib/candidateVisibility";
import AvailabilityRateCard from "./AvailabilityRateCard";
import GoingLiveWelcome from "./GoingLiveWelcome";

/**
 * The header of an approved candidate's dashboard.
 *
 * It exists because the screen underneath it was still running the application
 * pipeline: 30 of the 31 people currently listed on the marketplace were being
 * told "Your application is received" and handed a button back into the
 * proctored English exam, because the pipeline read english_mc_score and the
 * scores were reset. Some of them are in paid engagements.
 *
 * So this is not a celebration banner. Its job is to close the gap between
 * three things that have been free to disagree: what the candidate believes,
 * what this page says, and what clients actually see. Every claim here is
 * derived from the same predicate the marketplace query now enforces.
 */

interface Props {
  /** Offers still awaiting an answer, from the same loader /candidate/work uses. */
  pendingOfferCount?: number;
  /** Agreements this candidate can sign right now. */
  signableContractCount?: number;
  /** Agreements stopped because the document contradicts the engagement. */
  flaggedContractCount?: number;
  candidate: VisibilityInput & {
    id: string;
    first_name?: string | null;
    display_name?: string | null;
    full_name?: string | null;
    hourly_rate?: number | null;
    hours_per_week?: number | null;
    availability_date?: string | null;
    going_live_ack_at?: string | null;
    role_category?: string | null;
  };
}

export default function LivePortal({
  candidate,
  pendingOfferCount = 0,
  signableContractCount = 0,
  flaggedContractCount = 0,
}: Props) {
  const vis = computeVisibility(candidate);
  const stale = availabilityIsStale(candidate);
  const firstName =
    candidate.first_name ||
    (candidate.display_name || candidate.full_name || "there").split(" ")[0];

  // Blocking reasons first — a person who is hidden needs to read that before
  // anything else on the page.
  const reasons = [...vis.reasons].sort(
    (a, b) => Number(b.hidesFromSearch) - Number(a.hidesFromSearch)
  );

  return (
    <div className="mx-auto max-w-4xl px-4 pt-8">
      {/* Gated on the same predicate as everything else on the page. The
          welcome asserts "clients can now find you", so it must not greet an
          ID-overdue candidate whom the marketplace query excludes. */}
      {!candidate.going_live_ack_at && vis.searchable && (
        <GoingLiveWelcome firstName={firstName} />
      )}

      {/* An offer is the single most important thing that can be true of a
          live candidate, and with candidate email frozen this card is the ONLY
          way one reaches them. It sits above the status card on purpose. */}
      {pendingOfferCount > 0 && (
        <section className="mb-6 rounded-lg border border-[#FE6E3E] bg-orange-50 p-5">
          <h2 className="text-base font-bold text-[#1C1B1A]">
            {pendingOfferCount === 1
              ? "You have an offer waiting."
              : `You have ${pendingOfferCount} offers waiting.`}
          </h2>
          <p className="mt-1 text-sm text-gray-700">
            A client wants to work with you. Have a look and give them an answer.
          </p>
          <Link
            href="/candidate/work"
            className="mt-3 inline-block rounded-full bg-[#FE6E3E] px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#E55A2B]"
          >
            Review it
          </Link>
        </section>
      )}

      {signableContractCount > 0 && (
        <section className="mb-6 rounded-lg border border-[#FE6E3E] bg-orange-50 p-5">
          <h2 className="text-base font-bold text-[#1C1B1A]">
            {signableContractCount === 1
              ? "A contract is waiting for your signature."
              : `${signableContractCount} contracts are waiting for your signature.`}
          </h2>
          <p className="mt-1 text-sm text-gray-700">
            Read it through and sign when you&apos;re happy with the terms.
          </p>
          <Link
            href="/candidate/contracts"
            className="mt-3 inline-block rounded-full bg-[#FE6E3E] px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#E55A2B]"
          >
            Review it
          </Link>
        </section>
      )}

      {/* Separate from the card above, deliberately. "There's a problem" and
          "please sign" are different messages and must never be merged: a
          flagged contract is one nobody should sign yet. */}
      {flaggedContractCount > 0 && (
        <section className="mb-6 rounded-lg border border-red-200 bg-red-50 p-5">
          <h2 className="text-base font-bold text-red-900">
            There&apos;s a problem with a contract you were sent.
          </h2>
          <p className="mt-1 text-sm text-red-800">
            The pay terms in it don&apos;t match your engagement, so it can&apos;t
            be signed. Our team has been alerted. Nothing for you to do.
          </p>
          <Link
            href="/candidate/contracts"
            className="mt-3 inline-block text-sm font-semibold text-red-900 underline"
          >
            See the details
          </Link>
        </section>
      )}

      {/* ── Live status ── */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  vis.searchable ? "bg-green-500" : "bg-red-500"
                }`}
                aria-hidden
              />
              <span
                className={`text-xs font-semibold uppercase tracking-wide ${
                  vis.searchable ? "text-green-700" : "text-red-700"
                }`}
              >
                {vis.searchable ? "Live on the marketplace" : "Not visible to clients"}
              </span>
            </div>
            <h1 className="mt-2 text-xl font-bold text-[#1C1B1A]">
              {vis.searchable
                ? `You're live, ${firstName}.`
                : `Your profile is hidden, ${firstName}.`}
            </h1>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-gray-600">
              {!vis.searchable
                ? "Clients can't find you in search right now. The reason and the fix are below."
                : !vis.matchable
                  ? "Clients browsing StaffVA can find your profile. You're left out of new job matches for now — the reason is below."
                  : candidate.availability_status === "available_by_date"
                    // Both /api/jobs branches filter start_date "Immediately"
                    // down to available_now only, so "every new job" would be
                    // false for this candidate.
                    ? "Clients browsing StaffVA can find your profile, and you're matched to new work — except roles that need someone starting immediately."
                    : "Clients browsing StaffVA can find your profile, and you're included when they post new work."}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link
              href="/candidate/work"
              className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-[#1C1B1A] transition-colors hover:border-[#1C1B1A]"
            >
              See what&apos;s open
            </Link>
            <Link
              href="/candidate/messages"
              className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-[#1C1B1A] transition-colors hover:border-[#1C1B1A]"
            >
              Messages
            </Link>
            <Link
              href="/candidate/contracts"
              className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-[#1C1B1A] transition-colors hover:border-[#1C1B1A]"
            >
              Contracts
            </Link>
            <Link
              href={`/candidate/${candidate.id}`}
              className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-[#1C1B1A] transition-colors hover:border-[#1C1B1A]"
            >
              View my public profile
            </Link>
          </div>
        </div>

        {reasons.length > 0 && (
          <ul className="mt-4 space-y-2.5 border-t border-gray-100 pt-4">
            {reasons.map((r) => (
              <li
                key={r.kind}
                className={`rounded-lg border p-3 ${
                  r.hidesFromSearch
                    ? "border-red-200 bg-red-50"
                    : r.kind === "on_contract"
                      ? "border-gray-200 bg-gray-50"
                      : "border-amber-200 bg-amber-50"
                }`}
              >
                <p
                  className={`text-sm font-medium ${
                    r.hidesFromSearch
                      ? "text-red-800"
                      : r.kind === "on_contract"
                        ? "text-gray-800"
                        : "text-amber-900"
                  }`}
                >
                  {r.title}
                </p>
                <p
                  className={`mt-0.5 text-sm ${
                    r.hidesFromSearch
                      ? "text-red-700"
                      : r.kind === "on_contract"
                        ? "text-gray-600"
                        : "text-amber-800"
                  }`}
                >
                  {r.detail}
                </p>
                {r.action && (
                  <Link
                    href={r.action.href}
                    className="mt-1.5 inline-block text-sm font-semibold text-[#FE6E3E] hover:underline"
                  >
                    {r.action.label} →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Availability + rate ── */}
      <div className="mb-6">
        <AvailabilityRateCard
          status={candidate.availability_status || "available_now"}
          date={candidate.availability_date ?? null}
          rate={candidate.hourly_rate ?? null}
          hoursPerWeek={candidate.hours_per_week ?? null}
          lastUpdated={candidate.availability_last_updated_at ?? null}
          stale={stale}
        />
      </div>

      {/* Interview hours are the OTHER availability question — "when can a
          client book a call with you?" — and the dashboard below owns that
          card in both its states. Two panels here would read as one setting
          in two places. */}
    </div>
  );
}
