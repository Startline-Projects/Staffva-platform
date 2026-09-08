import Link from "next/link";
import {
  rankingScore,
  missingForRanking,
  type RankingInput,
} from "@/lib/searchRanking";

/**
 * "Here's why you sit where you sit in client search."
 *
 * Context: the 2026-09-07 relist listed the whole pipeline, and 202 of the
 * newly-listed candidates have no photo. Browse now orders by photo first,
 * then completeness (00219), which quietly puts those people at the back.
 * Telling them that — with the specific thing to fix — is the half of that
 * change that serves the candidate.
 *
 * Two rules this component keeps:
 *  - It only claims what the ordering actually does. "Above every profile
 *    without one" is literally true because photo is its own sort key.
 *  - It only renders for candidates who are actually IN search. Telling
 *    someone who is hidden that they rank low is noise on top of a bigger
 *    problem the visibility block above already explains.
 */
export default function ProfileRankNudge({
  candidate,
  searchable,
}: {
  candidate: RankingInput;
  searchable: boolean;
}) {
  if (!searchable) return null;

  const score = rankingScore(candidate);
  const missing = missingForRanking(candidate);
  if (missing.length === 0) return null;

  const noPhoto = !candidate.profile_photo_url;
  // The photo is the headline when it's missing; otherwise lead with the
  // biggest remaining win so the first thing suggested is the best-value one.
  const rest = missing.filter((m) => m.key !== "photo").slice(0, 3);

  return (
    <section
      className={`mb-6 rounded-xl border p-4 ${
        noPhoto ? "border-[#FE6E3E]/40 bg-[#FFF6F2]" : "border-gray-200 bg-gray-50"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[#1C1B1A]">
          {noPhoto ? "Add a photo to move up in search" : "Move up in client search"}
        </h2>
        <span className="font-mono text-xs text-gray-500">
          Profile {score}% complete
        </span>
      </div>

      {noPhoto ? (
        <p className="mt-1.5 text-sm text-gray-700">
          Clients see profiles with a photo <strong>above every profile
          without one</strong> — so right now you&apos;re behind everyone who has
          one, however good the rest of your profile is. It&apos;s the single
          biggest thing you can change today.
        </p>
      ) : (
        <p className="mt-1.5 text-sm text-gray-700">
          Client search shows profiles with a photo first, then the most
          complete ones. Yours has a photo — filling these in moves you up
          among them.
        </p>
      )}

      {rest.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {rest.map((m) => (
            <li key={m.key} className="text-sm text-gray-600">
              <span className="text-gray-400">·</span> {m.label}
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/candidate/profile/edit"
        className="mt-3 inline-block rounded-full bg-[#FE6E3E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#E55A2B]"
      >
        {noPhoto ? "Add your photo" : "Update your profile"}
      </Link>
      <p className="mt-2 text-xs text-gray-500">
        {/* Says what the flow does: edits are staff-reviewed, so a photo is
            not live the moment it uploads. Promising instant would be the
            copy-claims-what-code-doesn't defect in one sentence. */}
        Profile changes go to a reviewer before they appear to clients.
      </p>
    </section>
  );
}
