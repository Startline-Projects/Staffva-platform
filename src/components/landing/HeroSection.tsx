"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface HeroCandidate {
  id: string;
  display_name: string;
  role_category: string;
  monthly_rate: number;
  english_written_tier: string | null;
  country: string;
  profile_photo_url: string | null;
}

interface Props {
  heroPreview: HeroCandidate[];
}

const ROLE_PILLS = [
  "Paralegal",
  "Bookkeeper",
  "Legal Assistant",
  "Admin",
  "VA",
  "Scheduling",
  "Customer Support",
];

const TIER_COLORS: Record<string, string> = {
  exceptional: "bg-emerald-400/20 text-emerald-300",
  proficient: "bg-blue-400/20 text-blue-300",
  competent: "bg-gray-400/20 text-gray-300",
};

export default function HeroSection({ heroPreview }: Props) {
  const [query, setQuery] = useState("");
  const router = useRouter();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/browse?search=${encodeURIComponent(query.trim())}`);
    } else {
      router.push("/browse");
    }
  }

  return (
    <section className="relative bg-[#1C1B1A] overflow-hidden">
      <div className="mx-auto max-w-7xl px-6 pt-28 pb-20 lg:pt-36 lg:pb-28">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left column — text + search */}
          <div>
            <span className="inline-block text-sm font-semibold text-primary tracking-wide uppercase">
              Pre-vetted offshore professionals
            </span>
            <h1 className="mt-4 text-4xl sm:text-5xl lg:text-[3.5rem] font-bold leading-tight text-white">
              Find your next great hire.{" "}
              <span className="text-primary">Already vetted. Ready now.</span>
            </h1>
            <p className="mt-6 text-lg text-gray-400 leading-relaxed max-w-xl">
              Browse pre-vetted offshore paralegals, bookkeepers, admins, and
              legal assistants. Every candidate passed a human English and
              speaking assessment. Free to browse. You only pay when you hire.
            </p>

            {/* Search bar */}
            <form onSubmit={handleSearch} className="mt-8 flex gap-2 max-w-lg">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Try "paralegal" or "bookkeeper"...'
                className="flex-1 rounded-lg bg-white px-4 py-3.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                type="submit"
                className="rounded-lg bg-primary px-6 py-3.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors whitespace-nowrap"
              >
                Search
              </button>
            </form>

            {/* Audience labels */}
            <div className="mt-6 flex items-center gap-6 max-w-lg">
              <div className="flex items-center gap-2">
                <span className="h-px w-6 bg-gray-600" />
                <span className="text-xs text-gray-500">For businesses</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">For professionals</span>
                <a
                  href="/apply"
                  className="text-xs font-semibold text-primary underline underline-offset-2 hover:text-primary-dark transition-colors"
                >
                  Apply Now
                </a>
              </div>
            </div>

            {/* Role pills */}
            <div className="mt-5 flex flex-wrap gap-2">
              {ROLE_PILLS.map((role) => (
                <button
                  key={role}
                  onClick={() =>
                    router.push(
                      `/browse?role=${encodeURIComponent(role)}`
                    )
                  }
                  className="rounded-full border border-primary/40 px-3.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                >
                  {role}
                </button>
              ))}
            </div>

            {/* Trust badges */}
            <div className="mt-6 flex flex-wrap gap-6 text-sm text-gray-500">
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Escrow on every payment
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Zero candidate fees. Ever.
              </span>
            </div>
          </div>

          {/* Right column — floating candidate cards */}
          <div className="hidden lg:block relative h-[420px]">
            {heroPreview.length > 0 ? (
              heroPreview.map((c, i) => {
                const offsets = [
                  { top: "0px", right: "40px", rotate: "-2deg", delay: "0s" },
                  { top: "140px", right: "0px", rotate: "1deg", delay: "0.15s" },
                  { top: "280px", right: "60px", rotate: "-1deg", delay: "0.3s" },
                ];
                const pos = offsets[i] || offsets[0];
                const tier = c.english_written_tier
                  ? TIER_COLORS[c.english_written_tier]
                  : null;

                return (
                  <div
                    key={c.id}
                    className="absolute w-72 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10 p-5 shadow-2xl animate-fade-in-up"
                    style={{
                      top: pos.top,
                      right: pos.right,
                      transform: `rotate(${pos.rotate})`,
                      animationDelay: pos.delay,
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-700">
                        {c.profile_photo_url ? (
                          <img src={c.profile_photo_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-sm font-bold text-gray-400">
                            {c.display_name?.[0] || "?"}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-semibold text-white">
                              {c.display_name}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {c.country}
                            </p>
                          </div>
                          <span className="text-primary font-bold text-sm shrink-0">
                            ${c.monthly_rate.toLocaleString()}/mo
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
                        {c.role_category}
                      </span>
                      {tier && (
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tier}`}
                        >
                          {c.english_written_tier}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              // Placeholder cards when no candidates exist
              <>
                {[0, 1, 2].map((i) => {
                  const offsets = [
                    { top: "0px", right: "40px", rotate: "-2deg" },
                    { top: "140px", right: "0px", rotate: "1deg" },
                    { top: "280px", right: "60px", rotate: "-1deg" },
                  ];
                  const pos = offsets[i];
                  const names = ["Sarah M.", "Carlos R.", "Priya K."];
                  const countries = ["Philippines", "Colombia", "India"];
                  const roles = ["Paralegal", "Bookkeeper", "Legal Assistant"];
                  const rates = [850, 700, 900];

                  return (
                    <div
                      key={i}
                      className="absolute w-72 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10 p-5 shadow-2xl animate-fade-in-up"
                      style={{
                        top: pos.top,
                        right: pos.right,
                        transform: `rotate(${pos.rotate})`,
                        animationDelay: `${i * 0.15}s`,
                      }}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-white">{names[i]}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{countries[i]}</p>
                        </div>
                        <span className="text-primary font-bold text-sm">
                          ${rates[i]}/mo
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
                          {roles[i]}
                        </span>
                        <span className="rounded-full bg-emerald-400/20 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                          Proficient
                        </span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
