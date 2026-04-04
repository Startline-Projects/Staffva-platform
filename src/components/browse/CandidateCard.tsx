import Link from "next/link";
import InlineAudioPreview from "./InlineAudioPreview";

const TIER_STYLE: Record<string, string> = {
  exceptional: "bg-primary/10 text-primary",
  proficient: "bg-background text-text-secondary",
  competent: "bg-background text-text-tertiary",
};

const SPEAKING_STYLE: Record<string, string> = {
  fluent: "bg-indigo-50 text-indigo-600",
  proficient: "bg-background text-text-secondary",
  conversational: "bg-background text-text-tertiary",
  basic: "bg-background text-text-tertiary",
};

export interface CandidateCardData {
  id: string;
  display_name: string;
  country: string;
  role_category: string;
  hourly_rate: number;
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

function getAvailability(hours: number) {
  if (!hours || hours === 0) return { dot: "bg-green-500", text: "Available", color: "text-green-600" };
  if (hours < 40) return { dot: "bg-amber-500", text: `${50 - hours} hrs/week open`, color: "text-amber-600" };
  return { dot: "bg-gray-300", text: "Engaged", color: "text-text-tertiary" };
}

interface Props {
  candidate: CandidateCardData;
  isLoggedIn?: boolean;
}

export default function CandidateCard({ candidate, isLoggedIn = false }: Props) {
  const tier = candidate.english_written_tier ? TIER_STYLE[candidate.english_written_tier] : null;
  const tierLabel = candidate.english_written_tier
    ? candidate.english_written_tier.charAt(0).toUpperCase() + candidate.english_written_tier.slice(1)
    : null;
  const speaking = candidate.speaking_level ? SPEAKING_STYLE[candidate.speaking_level] : null;
  const speakingLabel = candidate.speaking_level
    ? candidate.speaking_level.charAt(0).toUpperCase() + candidate.speaking_level.slice(1)
    : null;
  const hasUS = candidate.us_client_experience === "full_time" || candidate.us_client_experience === "part_time_contract";
  const avail = getAvailability(candidate.committed_hours || 0);

  return (
    <div className="group rounded-2xl border border-border-light bg-card hover:border-text/20 transition-colors">
      <Link href={`/candidate/${candidate.id}`} className="block p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-background">
            {candidate.profile_photo_url ? (
              <img src={candidate.profile_photo_url} alt={candidate.display_name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-text-tertiary">
                {candidate.display_name?.[0] || "?"}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-text">{candidate.display_name}</h3>
                <p className="mt-0.5 text-xs text-text-tertiary">{candidate.country} · {candidate.role_category}</p>
              </div>
              <p className="text-base font-semibold text-text shrink-0 tabular-nums">
                ${candidate.hourly_rate.toLocaleString()}
                <span className="text-xs font-normal text-text-tertiary">/hr</span>
              </p>
            </div>
          </div>
        </div>

        {/* Availability */}
        <div className="mt-3 flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${avail.dot}`} />
          <span className={`text-xs ${avail.color}`}>{avail.text}</span>
        </div>

        {/* Badges */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tier && <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tier}`}>{tierLabel}</span>}
          {speaking && <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${speaking}`}>{speakingLabel}</span>}
          {hasUS && <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-[11px] font-medium text-green-700">US exp.</span>}
        </div>

        {/* Earnings */}
        {candidate.total_earnings_usd > 0 && (
          <p className="mt-2.5 text-xs text-text-tertiary">
            ${Number(candidate.total_earnings_usd).toLocaleString()} earned
          </p>
        )}

        {/* Bio */}
        {candidate.bio && (
          <p className="mt-2 text-[13px] leading-relaxed text-text-muted line-clamp-2">{candidate.bio}</p>
        )}
      </Link>

      {/* Audio */}
      <div className="px-5 pb-4">
        <InlineAudioPreview
          previewUrl={candidate.voice_recording_1_preview_url || null}
          isLoggedIn={isLoggedIn}
          candidateName={candidate.display_name}
        />
      </div>
    </div>
  );
}
