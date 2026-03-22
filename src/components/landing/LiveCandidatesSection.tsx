import Link from "next/link";

interface LiveCandidate {
  id: string;
  display_name: string;
  country: string;
  role_category: string;
  monthly_rate: number;
  english_written_tier: string | null;
  speaking_level: string | null;
  availability_status: string;
  total_earnings_usd: number;
  lock_status: string;
  bio: string | null;
  us_client_experience: string;
}

interface Props {
  candidates: LiveCandidate[];
}

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

const SAMPLE_CANDIDATES = [
  { display_name: "Maria S.", country: "Philippines", role_category: "Paralegal", monthly_rate: 1200, english_written_tier: "exceptional", speaking_level: "fluent" },
  { display_name: "Ahmed K.", country: "Lebanon", role_category: "Bookkeeper", monthly_rate: 1400, english_written_tier: "proficient", speaking_level: "proficient" },
  { display_name: "Sofia R.", country: "Brazil", role_category: "Legal Assistant", monthly_rate: 1100, english_written_tier: "proficient", speaking_level: "conversational" },
  { display_name: "Grace T.", country: "Philippines", role_category: "Admin", monthly_rate: 900, english_written_tier: "competent", speaking_level: "proficient" },
  { display_name: "Omar H.", country: "Egypt", role_category: "Bookkeeper", monthly_rate: 1300, english_written_tier: "exceptional", speaking_level: "fluent" },
  { display_name: "Lea M.", country: "Philippines", role_category: "Paralegal", monthly_rate: 1500, english_written_tier: "exceptional", speaking_level: "fluent" },
];

export default function LiveCandidatesSection({ candidates }: Props) {
  return (
    <section className="bg-background py-20">
      <div className="mx-auto max-w-7xl px-6">
        <h2 className="text-center text-3xl font-bold text-text">
          Who&apos;s available right now
        </h2>

        {candidates.length > 0 ? (
          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {candidates.map((c) => {
              const tier = c.english_written_tier
                ? TIER_CONFIG[c.english_written_tier]
                : null;
              const speaking = c.speaking_level
                ? SPEAKING_CONFIG[c.speaking_level]
                : null;

              return (
                <div
                  key={c.id}
                  className="rounded-xl border border-gray-200 bg-card p-5 shadow-sm hover:shadow-md hover:border-primary/30 transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-text">
                        {c.display_name}
                      </h3>
                      <p className="text-sm text-text/60 mt-0.5">{c.country}</p>
                    </div>
                    <p className="text-lg font-bold text-primary">
                      ${c.monthly_rate.toLocaleString()}
                      <span className="text-xs font-normal text-text/40">
                        /mo
                      </span>
                    </p>
                  </div>

                  {/* Role pill */}
                  <div className="mt-3">
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {c.role_category}
                    </span>
                  </div>

                  {/* Badges */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {tier && (
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tier.color}`}
                      >
                        {tier.label}
                      </span>
                    )}
                    {speaking && (
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${speaking.color}`}
                      >
                        {speaking.label}
                      </span>
                    )}
                  </div>

                  {/* Verified earnings */}
                  {c.total_earnings_usd > 0 && (
                    <p className="mt-2 text-xs font-medium text-green-600">
                      ${Number(c.total_earnings_usd).toLocaleString()} earned on
                      platform
                    </p>
                  )}

                  {/* Availability + CTA */}
                  <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-green-600">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      Available now
                    </span>
                    <Link
                      href={`/candidate/${c.id}`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      View Profile &rarr;
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {SAMPLE_CANDIDATES.map((c) => {
              const tier = TIER_CONFIG[c.english_written_tier];
              const speaking = SPEAKING_CONFIG[c.speaking_level];

              return (
                <div
                  key={c.display_name}
                  className="rounded-xl border border-gray-200 bg-card p-5 shadow-sm hover:shadow-md hover:border-primary/30 transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-text">
                        {c.display_name}
                      </h3>
                      <p className="text-sm text-text/60 mt-0.5">{c.country}</p>
                    </div>
                    <p className="text-lg font-bold text-primary">
                      ${c.monthly_rate.toLocaleString()}
                      <span className="text-xs font-normal text-text/40">
                        /mo
                      </span>
                    </p>
                  </div>

                  <div className="mt-3">
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {c.role_category}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tier.color}`}
                    >
                      {tier.label}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${speaking.color}`}
                    >
                      {speaking.label}
                    </span>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-green-600">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      Available now
                    </span>
                    <span className="text-xs font-medium text-primary">
                      View Profile &rarr;
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-10 text-center">
          <Link
            href="/browse"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
          >
            Browse All Candidates
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}
