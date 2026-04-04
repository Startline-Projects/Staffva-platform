import Link from "next/link";

interface LiveCandidate {
  id: string;
  display_name: string;
  country: string;
  role_category: string;
  hourly_rate: number;
  english_written_tier: string | null;
  speaking_level: string | null;
  availability_status: string;
  total_earnings_usd: number;
  lock_status: string;
  bio: string | null;
  us_client_experience: string;
  profile_photo_url: string | null;
}

interface Props {
  candidates: LiveCandidate[];
}

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

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function LiveCandidatesSection({ candidates }: Props) {
  const cards = candidates.length > 0 ? candidates : [];

  if (cards.length === 0) return null;

  return (
    <section className="bg-background py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <p className="text-center text-sm font-medium tracking-widest uppercase text-text-tertiary">
          Available now
        </p>
        <h2 className="mt-4 text-center text-3xl sm:text-4xl font-semibold tracking-tight text-text">
          Who&apos;s available right now
        </h2>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {cards.slice(0, 6).map((c) => {
            const tierStyle = c.english_written_tier ? TIER_STYLE[c.english_written_tier] : null;
            const speakingStyle = c.speaking_level ? SPEAKING_STYLE[c.speaking_level] : null;

            return (
              <Link
                key={c.id}
                href={`/candidate/${c.id}`}
                className="group rounded-2xl border border-border-light bg-card p-5 hover:border-text/20 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-background">
                    {c.profile_photo_url ? (
                      <img src={c.profile_photo_url} alt={c.display_name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-text-tertiary">
                        {c.display_name?.[0] || "?"}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-text">{c.display_name}</h3>
                        <p className="mt-0.5 text-xs text-text-tertiary">{c.country} · {c.role_category}</p>
                      </div>
                      <p className="text-base font-semibold text-text shrink-0 tabular-nums">
                        ${c.hourly_rate.toLocaleString()}
                        <span className="text-xs font-normal text-text-tertiary">/hr</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Badges */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {tierStyle && (
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tierStyle}`}>
                      {capitalize(c.english_written_tier!)}
                    </span>
                  )}
                  {speakingStyle && (
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${speakingStyle}`}>
                      {capitalize(c.speaking_level!)}
                    </span>
                  )}
                </div>

                {/* Earnings */}
                {c.total_earnings_usd > 0 && (
                  <p className="mt-2.5 text-xs text-text-tertiary">
                    ${Number(c.total_earnings_usd).toLocaleString()} earned
                  </p>
                )}

                {/* Footer */}
                <div className="mt-4 flex items-center justify-between pt-3 border-t border-border-light">
                  <span className="flex items-center gap-1.5 text-xs text-green-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    Available
                  </span>
                  <span className="text-xs font-medium text-text-tertiary group-hover:text-text transition-colors">
                    View →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="mt-12 text-center">
          <Link
            href="/browse"
            className="rounded-full border border-border px-8 py-3 text-sm font-medium text-text hover:border-text transition-colors"
          >
            See all
          </Link>
        </div>
      </div>
    </section>
  );
}
