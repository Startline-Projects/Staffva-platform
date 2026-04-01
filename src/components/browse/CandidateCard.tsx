import Link from "next/link";
import InlineAudioPreview from "./InlineAudioPreview";

// Step 6 — Badge visual hierarchy
const TIER_CONFIG: Record<string, { label: string; style: string }> = {
  exceptional: { label: "Exceptional", style: "bg-[rgba(254,110,62,0.10)] text-[#FE6E3E] font-medium" },
  proficient: { label: "Proficient", style: "bg-[#f2efe8] text-[#5a5550] font-normal" },
  competent: { label: "Competent", style: "bg-[#f2efe8] text-[#9a9590] font-normal" },
};

const SPEAKING_CONFIG: Record<string, { label: string; style: string }> = {
  fluent: { label: "Fluent", style: "bg-[rgba(99,102,241,0.10)] text-[#6366f1] font-medium" },
  proficient: { label: "Proficient", style: "bg-[#f2efe8] text-[#5a5550] font-normal" },
  conversational: { label: "Conversational", style: "bg-[#f2efe8] text-[#9a9590] font-normal" },
  basic: { label: "Basic", style: "bg-[#f2efe8] text-[#9a9590] font-normal" },
};

// Static waveform bars for audio badge
function StaticWaveform() {
  const heights = [3, 8, 5, 10, 4, 7, 6, 11];
  return (
    <div className="flex items-end gap-[2px] ml-auto">
      {heights.map((h, i) => (
        <div key={i} className="rounded-[1px]" style={{ width: 2, height: h, background: "#FE6E3E", opacity: 0.45 }} />
      ))}
    </div>
  );
}

export interface CandidateCardData {
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
  needs_availability_update?: boolean;
  voice_recording_1_preview_url?: string | null;
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
  isLoggedIn?: boolean;
}

export default function CandidateCard({ candidate, isLoggedIn = false }: Props) {
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
    <div className="rounded-xl border border-gray-200 bg-card cursor-pointer" style={{ transition: "border-color 0.15s ease" }} onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#FE6E3E")} onMouseLeave={(e) => (e.currentTarget.style.borderColor = "")}>
      <Link
        href={`/candidate/${candidate.id}`}
        className="block p-5 pb-3"
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
          {candidate.needs_availability_update && (
            <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
              Availability unconfirmed
            </span>
          )}
        </div>

        {/* Badges — Step 6 visual hierarchy */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tier && (
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${tier.style}`}>
              {tier.label}
            </span>
          )}
          {speaking && (
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${speaking.style}`}>
              {speaking.label}
            </span>
          )}
          {hasUSExperience && (
            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: "rgba(34,197,94,0.10)", color: "#16a34a" }}>
              US Experience
            </span>
          )}
          {hasInternational && (
            <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">
              International
            </span>
          )}
        </div>

        {/* Step 4 — Voice recording audio badge */}
        <div
          className="mt-2.5 flex items-center gap-[7px] rounded-[8px] px-[10px] py-[8px] mb-[10px]"
          style={{ background: "#f8f6f2", border: "0.5px solid #e4e0d8" }}
        >
          <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#FE6E3E] shrink-0">
            <svg className="w-[8px] h-[8px] text-white ml-[1px]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <span className="text-[10px] text-[#9a9590]">Voice recording available</span>
          <StaticWaveform />
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
      </Link>

      {/* Audio preview — outside the Link to prevent navigation */}
      <div className="px-5 pb-3">
        <InlineAudioPreview
          previewUrl={candidate.voice_recording_1_preview_url || null}
          isLoggedIn={isLoggedIn}
          candidateName={candidate.display_name}
        />
      </div>

      {/* Footer */}
      <Link
        href={`/candidate/${candidate.id}`}
        className="block border-t border-gray-100 px-5 py-3"
      >
        <span className="text-xs text-primary font-medium">
          View Profile &rarr;
        </span>
      </Link>
    </div>
  );
}
