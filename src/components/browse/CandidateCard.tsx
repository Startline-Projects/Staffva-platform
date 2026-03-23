import Link from "next/link";

const TIER_CONFIG: Record<string, { label: string; color: string }> = {
  exceptional: { label: "Exceptional", color: "bg-emerald-100 text-emerald-700" },
  proficient: { label: "Proficient", color: "bg-blue-100 text-blue-700" },
  competent: { label: "Competent", color: "bg-gray-100 text-gray-700" },
};

const SPEAKING_CONFIG: Record<string, { label: string; color: string }> = {
  fluent: { label: "Fluent", color: "bg-emerald-100 text-emerald-700" },
  proficient: { label: "Proficient", color: "bg-blue-100 text-blue-700" },
  conversational: { label: "Conversational", color: "bg-amber-100 text-amber-700" },
  basic: { label: "Basic", color: "bg-gray-100 text-gray-700" },
};

interface CandidateCardData {
  id: string;
  display_name: string;
  country: string;
  role_category: string;
  monthly_rate: number;
  english_written_tier: string | null;
  speaking_level: string | null;
  availability_status: string;
  us_client_experience: string;
  bio: string | null;
  total_earnings_usd: number;
  committed_hours: number;
  profile_photo_url: string | null;
}

function getAvailabilityDisplay(committedHours: number) {
  if (!committedHours || committedHours === 0) {
    return { dot: "bg-green-500", text: "Available", textColor: "text-green-600", status: "available" };
  }
  if (committedHours < 40) {
    const remaining = 50 - committedHours;
    return { dot: "bg-amber-500", text: `Available — ${remaining} hrs/week remaining`, textColor: "text-amber-600", status: "partial" };
  }
  return { dot: "bg-gray-400", text: "Not Available — Currently Engaged", textColor: "text-gray-400", status: "unavailable" };
}

interface Props {
  candidate: CandidateCardData;
}

export default function CandidateCard({ candidate }: Props) {
  const tier = candidate.english_written_tier
    ? TIER_CONFIG[candidate.english_written_tier]
    : null;
  const speaking = candidate.speaking_level
    ? SPEAKING_CONFIG[candidate.speaking_level]
    : null;
  const hasUSExperience =
    candidate.us_client_experience === "full_time" ||
    candidate.us_client_experience === "part_time_contract";
  const hasInternational =
    candidate.us_client_experience === "international_only";
  const avail = getAvailabilityDisplay(candidate.committed_hours || 0);

  return (
    <Link
      href={`/candidate/${candidate.id}`}
      className="block rounded-xl border border-gray-200 bg-card p-5 transition-all hover:border-primary/30 hover:shadow-md"
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-gray-100">
          {candidate.profile_photo_url ? (
            <img
              src={candidate.profile_photo_url}
              alt={candidate.display_name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-lg font-bold text-text/30">
              {candidate.display_name?.[0] || "?"}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-text">{candidate.display_name}</h3>
              <p className="mt-0.5 text-sm text-text/60">
                {candidate.country} &middot; {candidate.role_category}
              </p>
            </div>
            <p className="text-lg font-bold text-text shrink-0">
              ${candidate.monthly_rate.toLocaleString()}
              <span className="text-xs font-normal text-text/40">/mo</span>
            </p>
          </div>
        </div>
      </div>

      {/* Availability status */}
      <div className="mt-2 flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${avail.dot}`} />
        <span className={`text-xs font-medium ${avail.textColor}`}>
          {avail.text}
        </span>
      </div>

      {/* Badges */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {tier && (
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tier.color}`}>
            {tier.label}
          </span>
        )}
        {speaking && (
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${speaking.color}`}>
            {speaking.label}
          </span>
        )}
        {hasUSExperience && (
          <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
            US Experience
          </span>
        )}
        {hasInternational && (
          <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">
            International
          </span>
        )}
      </div>

      {/* Verified earnings */}
      {candidate.total_earnings_usd > 0 && (
        <p className="mt-2 text-xs font-medium text-text/50">
          ${Number(candidate.total_earnings_usd).toLocaleString()} verified earnings
        </p>
      )}

      {/* Bio snippet */}
      {candidate.bio && (
        <p className="mt-2 text-sm text-text/60 line-clamp-2">
          {candidate.bio}
        </p>
      )}

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
        <span className="text-xs text-primary font-medium">
          View Profile &rarr;
        </span>
      </div>
    </Link>
  );
}
