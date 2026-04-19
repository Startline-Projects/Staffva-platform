import Link from "next/link";
import InlineAudioPreview from "./InlineAudioPreview";

export interface CandidateCardData {
  id: string;
  display_name: string;
  country: string;
  role_category: string;
  hourly_rate: number;
  english_written_tier: string | null;
  availability_status: string;
  us_client_experience: string | null;
  bio: string | null;
  tagline?: string | null;
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
  skills?: string[] | null;
  ai_insight_1?: string | null;
  ai_insight_2?: string | null;
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
  if (!hours || hours === 0) return "bg-green-500";
  if (hours < 40) return "bg-amber-500";
  return "bg-gray-300";
}

export function getEarningsBucketLabel(amount: number | null | undefined): string | null {
  if (!amount || amount <= 0) return null;
  if (amount >= 100000) return "$100K+ earned";
  if (amount >= 50000) return "$50K+ earned";
  if (amount >= 25000) return "$25K+ earned";
  if (amount >= 10000) return "$10K+ earned";
  if (amount >= 5000) return "$5K+ earned";
  return "$1K+ earned";
}

interface Props {
  candidate: CandidateCardData;
  isLoggedIn?: boolean;
  onSkillClick?: (skill: string) => void;
  activeSkills?: string[];
  onCardClick?: (id: string) => void;
}

export default function CandidateCard({ candidate, isLoggedIn = false, onSkillClick, activeSkills = [], onCardClick }: Props) {
  const availDot = getAvailability(candidate.committed_hours || 0);
  const skills = candidate.skills || [];
  const maxSkills = 6;
  const visibleSkills = skills.slice(0, maxSkills);
  const overflowCount = skills.length - maxSkills;

  const earningsLabel = getEarningsBucketLabel(candidate.total_earnings_usd);

  return (
    <div className="group relative border-b border-gray-100 bg-white hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer">
      {/* ═══ DESKTOP LAYOUT ═══ */}
      <div className="hidden md:flex items-start gap-4 p-5">
        {/* Left — Photo */}
        <div onClick={() => onCardClick?.(candidate.id)} className="shrink-0 cursor-pointer">
          <div className="relative">
            <div className="h-14 w-14 overflow-hidden rounded-full bg-gray-100">
              {candidate.profile_photo_url ? (
                <img src={candidate.profile_photo_url} alt={candidate.display_name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-text-tertiary">
                  {candidate.display_name?.[0] || "?"}
                </div>
              )}
            </div>
            <span className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white ${availDot}`} />
          </div>
        </div>

        {/* Center — Info */}
        <div onClick={() => onCardClick?.(candidate.id)} className="flex-1 min-w-0 cursor-pointer">
          {/* Row 1: Name + tier */}
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[#1C1B1A] truncate">{candidate.display_name}</h3>
            {candidate.reputation_tier === "Elite" && (
              <span className="shrink-0 rounded-full bg-amber-700 px-2 py-0.5 text-[9px] font-bold text-amber-100">Elite</span>
            )}
            {candidate.reputation_tier === "Top Rated" && (
              <span className="shrink-0 rounded-full bg-[#FE6E3E] px-2 py-0.5 text-[9px] font-bold text-white">Top Rated</span>
            )}
            {candidate.reputation_tier === "Rising" && (
              <span className="shrink-0 rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-bold text-white">Rising</span>
            )}
          </div>

          {/* Row 2: Tagline (primary) + Role category (secondary) */}
          {candidate.tagline ? (
            <>
              <p className="mt-0.5 text-sm font-medium text-[#1C1B1A] truncate">{candidate.tagline}</p>
              <p className="mt-0.5 text-[11px] text-text-tertiary">{candidate.role_category} &middot; {candidate.country}</p>
            </>
          ) : (
            <>
              <p className="mt-0.5 text-sm font-medium text-[#1C1B1A] truncate">{candidate.role_category}</p>
              <p className="mt-0.5 text-[11px] text-text-tertiary">{candidate.country}</p>
            </>
          )}

          {/* Row 4: Rate + reputation + earnings */}
          <div className="mt-1.5 flex items-center gap-1.5 text-xs">
            <span className="font-semibold text-[#FE6E3E]">${candidate.hourly_rate}/hr</span>
            {candidate.reputation_score && candidate.reputation_score > 0 && (
              <>
                <span className="text-gray-300">&middot;</span>
                <span className="text-text-secondary">{candidate.reputation_score}% reputation</span>
              </>
            )}
            {earningsLabel && (
              <>
                <span className="text-gray-300">&middot;</span>
                <span className="text-green-600">{earningsLabel}</span>
              </>
            )}
          </div>

          {/* Row 5: Skill tags — clickable */}
          {visibleSkills.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1" onClick={(e) => e.preventDefault()}>
              {visibleSkills.map((s) => {
                const isActive = activeSkills.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSkillClick?.(s); }}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer ${
                      isActive
                        ? "bg-[#FE6E3E] text-white"
                        : "bg-gray-100 text-text-secondary hover:bg-gray-200"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
              {overflowCount > 0 && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-text-tertiary">+{overflowCount}</span>
              )}
            </div>
          )}

          {/* Row 6: AI Insights */}
          {(candidate.ai_insight_1 || candidate.ai_insight_2) && (
            <ul className="mt-1.5 space-y-0.5">
              {candidate.ai_insight_1 && <li className="text-[11px] text-text-secondary leading-relaxed">• {candidate.ai_insight_1}</li>}
              {candidate.ai_insight_2 && <li className="text-[11px] text-text-secondary leading-relaxed">• {candidate.ai_insight_2}</li>}
            </ul>
          )}

          {/* Row 7: Bio excerpt */}
          {candidate.bio && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted italic line-clamp-2">{candidate.bio}</p>
          )}
        </div>

        {/* Right — Actions */}
        <div className="shrink-0 w-[140px] flex flex-col items-end gap-2">
          {/* Audio player */}
          <div className="w-full" onClick={(e) => e.stopPropagation()}>
            <InlineAudioPreview
              previewUrl={candidate.voice_recording_1_preview_url || null}
              isLoggedIn={isLoggedIn}
              candidateName={candidate.display_name}
            />
          </div>

          {/* View Profile button */}
          <Link
            href={`/candidate/${candidate.id}`}
            className="w-full rounded-lg bg-[#FE6E3E] py-2 text-center text-xs font-semibold text-white hover:bg-[#E55A2B] transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            View Profile
          </Link>
        </div>
      </div>

      {/* ═══ MOBILE LAYOUT ═══ */}
      <div className="md:hidden p-4 space-y-2.5">
        {/* Row 1: Photo + Name */}
        <div onClick={() => onCardClick?.(candidate.id)} className="flex items-center gap-3 cursor-pointer">
          <div className="relative shrink-0">
            <div className="h-11 w-11 overflow-hidden rounded-full bg-gray-100">
              {candidate.profile_photo_url ? (
                <img src={candidate.profile_photo_url} alt={candidate.display_name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-text-tertiary">{candidate.display_name?.[0] || "?"}</div>
              )}
            </div>
            <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white ${availDot}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-[#1C1B1A] truncate">{candidate.display_name}</h3>
              {candidate.reputation_tier === "Elite" && <span className="shrink-0 rounded-full bg-amber-700 px-1.5 py-0.5 text-[8px] font-bold text-amber-100">Elite</span>}
              {candidate.reputation_tier === "Top Rated" && <span className="shrink-0 rounded-full bg-[#FE6E3E] px-1.5 py-0.5 text-[8px] font-bold text-white">Top Rated</span>}
            </div>
            <p className="text-[11px] text-text-tertiary">{candidate.country}</p>
          </div>
        </div>

        {/* Row 2: Tagline (primary) + Role category (secondary) */}
        {candidate.tagline ? (
          <>
            <p className="text-sm font-medium text-[#1C1B1A] truncate">{candidate.tagline}</p>
            <p className="text-[11px] text-text-tertiary">{candidate.role_category}</p>
          </>
        ) : (
          <p className="text-sm font-medium text-[#1C1B1A] truncate">{candidate.role_category}</p>
        )}

        {/* Row 3: Rate + signals */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-semibold text-[#FE6E3E]">${candidate.hourly_rate}/hr</span>
          {candidate.reputation_score && candidate.reputation_score > 0 && (
            <>
              <span className="text-gray-300">&middot;</span>
              <span className="text-text-secondary">{candidate.reputation_score}%</span>
            </>
          )}
          {earningsLabel && (
            <>
              <span className="text-gray-300">&middot;</span>
              <span className="text-green-600 text-[11px]">{earningsLabel}</span>
            </>
          )}
        </div>

        {/* Row 4: Skill tags — clickable */}
        {visibleSkills.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {visibleSkills.slice(0, 4).map((s) => {
              const isActive = activeSkills.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSkillClick?.(s); }}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors active:scale-95 ${
                    isActive ? "bg-[#FE6E3E] text-white" : "bg-gray-100 text-text-secondary hover:bg-gray-200"
                  }`}
                >
                  {s}
                </button>
              );
            })}
            {skills.length > 4 && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-text-tertiary">+{skills.length - 4}</span>}
          </div>
        )}

        {/* Row 5: AI Insights */}
        {(candidate.ai_insight_1 || candidate.ai_insight_2) && (
          <ul className="space-y-0.5">
            {candidate.ai_insight_1 && <li className="text-[11px] text-text-secondary leading-relaxed">• {candidate.ai_insight_1}</li>}
            {candidate.ai_insight_2 && <li className="text-[11px] text-text-secondary leading-relaxed">• {candidate.ai_insight_2}</li>}
          </ul>
        )}

        {/* Row 6: Audio + View Profile */}
        <div className="flex items-center gap-2">
          <div className="flex-1" onClick={(e) => e.stopPropagation()}>
            <InlineAudioPreview
              previewUrl={candidate.voice_recording_1_preview_url || null}
              isLoggedIn={isLoggedIn}
              candidateName={candidate.display_name}
            />
          </div>
          <Link
            href={`/candidate/${candidate.id}`}
            className="shrink-0 rounded-lg bg-[#FE6E3E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#E55A2B] transition-colors"
          >
            View Profile
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton Card ───
export function CandidateCardSkeleton() {
  return (
    <div className="border-b border-gray-100 bg-white p-5 animate-pulse">
      <div className="hidden md:flex items-start gap-4">
        <div className="h-14 w-14 rounded-full bg-gray-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-40 rounded bg-gray-200" />
          <div className="h-3 w-64 rounded bg-gray-100" />
          <div className="h-3 w-24 rounded bg-gray-100" />
          <div className="h-3 w-48 rounded bg-gray-100" />
          <div className="flex gap-1 mt-1">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-5 w-16 rounded-full bg-gray-100" />)}
          </div>
        </div>
        <div className="w-[140px] space-y-2">
          <div className="h-8 w-full rounded-lg bg-gray-100" />
          <div className="h-8 w-full rounded-lg bg-gray-200" />
        </div>
      </div>
      <div className="md:hidden space-y-2">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-full bg-gray-200" />
          <div className="space-y-1 flex-1">
            <div className="h-4 w-32 rounded bg-gray-200" />
            <div className="h-3 w-20 rounded bg-gray-100" />
          </div>
        </div>
        <div className="h-3 w-48 rounded bg-gray-100" />
        <div className="h-3 w-32 rounded bg-gray-100" />
      </div>
    </div>
  );
}
