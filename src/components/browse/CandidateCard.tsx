import Link from "next/link";
import InlineAudioPreview from "./InlineAudioPreview";

const TIER_STYLE: Record<string, string> = {
  exceptional: "bg-primary/10 text-primary",
  advanced: "bg-background text-text-secondary",
  professional: "bg-background text-text-tertiary",
};

const SPEAKING_STYLE: Record<string, string> = {
  fluent: "bg-indigo-50 text-indigo-600",
  proficient: "bg-background text-text-secondary",
  conversational: "bg-background text-text-tertiary",
  developing: "bg-background text-text-tertiary",
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
  english_mc_score?: number | null;
  english_comprehension_score?: number | null;
  reputation_score?: number | null;
  reputation_tier?: string | null;
  video_intro_status?: string | null;
  ai_interview?: {
    overall_score: number | null;
    technical_knowledge_score: number | null;
    problem_solving_score: number | null;
    communication_score: number | null;
    experience_depth_score: number | null;
    professionalism_score: number | null;
  } | null;
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
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-semibold text-text">{candidate.display_name}</h3>
                  {candidate.reputation_tier === "Elite" && (
                    <span className="rounded-full bg-amber-700 px-1.5 py-0.5 text-[9px] font-bold text-amber-100">Elite</span>
                  )}
                  {candidate.reputation_tier === "Top Rated" && (
                    <span className="rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-white">Top Rated</span>
                  )}
                </div>
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
          {candidate.video_intro_status === "approved" && (
            <span className="group/video relative" title="This professional has a video introduction">
              <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden w-44 rounded-lg bg-charcoal px-2 py-1 text-[10px] text-white text-center group-hover/video:block z-10">
                Video introduction available — view profile to watch
              </span>
            </span>
          )}
        </div>

        {/* AI Score Display */}
        {candidate.ai_interview?.overall_score ? (() => {
          const score = candidate.ai_interview.overall_score;
          const borderColor = score >= 80 ? "border-primary" : score >= 60 ? "border-amber-500" : "border-gray-300";
          const textColor = score >= 80 ? "text-primary" : score >= 60 ? "text-amber-600" : "text-gray-400";
          return (
            <div className="mt-3 flex items-center gap-2.5 group/score relative">
              <div className={`flex h-10 w-10 items-center justify-center rounded-full border-2 ${borderColor}`}>
                <span className={`text-sm font-bold ${textColor}`}>{score}</span>
              </div>
              <span className="text-[11px] text-text-tertiary">AI Interview Score</span>
              <div className="pointer-events-none absolute bottom-full left-0 mb-2 hidden w-56 rounded-lg bg-charcoal px-3 py-2 text-[11px] text-white shadow-lg group-hover/score:block z-10">
                Scores are generated by AI-administered assessments and verified by our team. They are locked and cannot be edited by the candidate.
              </div>
            </div>
          );
        })() : (candidate.english_mc_score && candidate.english_comprehension_score) ? (
          <div className="mt-3 flex items-center gap-1.5 group/score relative">
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
              Reading {candidate.english_comprehension_score}
            </span>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
              Language {candidate.english_mc_score}
            </span>
            <div className="pointer-events-none absolute bottom-full left-0 mb-2 hidden w-56 rounded-lg bg-charcoal px-3 py-2 text-[11px] text-white shadow-lg group-hover/score:block z-10">
              Scores are generated by AI-administered assessments and verified by our team. They are locked and cannot be edited by the candidate.
            </div>
          </div>
        ) : null}

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
