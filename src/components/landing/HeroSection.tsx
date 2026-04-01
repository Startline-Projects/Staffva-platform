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

const ROLE_CHIPS = [
  { label: "Paralegal", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
  { label: "Bookkeeper", icon: "M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" },
  { label: "Legal Assistant", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { label: "Admin", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
  { label: "VA", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" },
  { label: "Scheduling", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
  { label: "Customer Support", icon: "M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" },
];

// Animated waveform bars component
function WaveformBars({ size = "sm" }: { size?: "sm" | "lg" }) {
  const heights = size === "lg"
    ? [3, 8, 5, 10, 4, 7, 6, 11]
    : [2, 5, 3, 7, 3, 5, 4, 6];

  return (
    <div className="flex items-end gap-[2px]">
      {heights.map((h, i) => (
        <div
          key={i}
          className="rounded-[1px]"
          style={{
            width: 2,
            height: h,
            background: "#FE6E3E",
            opacity: size === "sm" ? 0.45 : 1,
            animation: size === "lg" ? `waveform 1.2s ease-in-out infinite` : undefined,
            animationDelay: size === "lg" ? `${i * 0.1}s` : undefined,
          }}
        />
      ))}
    </div>
  );
}

export default function HeroSection({ heroPreview: _heroPreview }: Props) {
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
    <>
      {/* Waveform keyframes */}
      <style jsx global>{`
        @keyframes waveform {
          0%, 100% { transform: scaleY(0.2); }
          50% { transform: scaleY(1.0); }
        }
      `}</style>

      <section className="relative bg-white overflow-hidden">
        <div className="mx-auto max-w-7xl px-6 pt-16 pb-20 lg:pt-20 lg:pb-28">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left column — text + search */}
            <div>
              <span className="inline-block text-sm font-semibold text-primary tracking-wide uppercase">
                Pre-vetted offshore professionals
              </span>
              <h1 className="mt-4 text-4xl sm:text-5xl lg:text-[3.5rem] font-bold leading-tight text-[#1C1B1A]">
                Find your next great hire.{" "}
                <span className="text-primary">Already vetted. Ready now.</span>
              </h1>
              <p className="mt-6 text-lg text-[#666666] leading-relaxed max-w-xl">
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
                  className="flex-1 rounded-lg bg-white border border-[#E0E0E0] px-4 py-3.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
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
                  <span className="h-px w-6 bg-gray-300" />
                  <span className="text-xs text-[#666666]">For businesses</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#666666]">For professionals</span>
                  <a
                    href="/apply"
                    className="text-xs font-semibold text-primary underline underline-offset-2 hover:text-primary-dark transition-colors"
                  >
                    Apply Now
                  </a>
                </div>
              </div>

              {/* Role chips with icons */}
              <div className="mt-5 flex flex-wrap gap-2">
                {ROLE_CHIPS.map((chip) => (
                  <button
                    key={chip.label}
                    onClick={() =>
                      router.push(`/browse?role=${encodeURIComponent(chip.label)}`)
                    }
                    className="group flex items-center gap-[5px] rounded-[20px] border border-[#e0dbd5] bg-white px-[14px] py-[6px] text-[12px] text-[#5a5550] hover:border-[#FE6E3E] hover:text-[#FE6E3E] transition-colors cursor-pointer"
                  >
                    <svg
                      className="w-[11px] h-[11px] opacity-50 group-hover:opacity-80"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d={chip.icon} />
                    </svg>
                    {chip.label}
                  </button>
                ))}
              </div>

              {/* Trust badges */}
              <div className="mt-6 flex flex-wrap gap-6 text-sm text-[#1C1B1A]">
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

            {/* Right column — Hero photo with floating profile cards */}
            <div className="hidden lg:block relative">
              <div className="relative w-[560px] h-[520px] rounded-[16px] overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/hero-photo.svg"
                  alt="StaffVA professional"
                  className="w-full h-full object-cover object-top"
                />
              </div>

              {/* Floating card — bottom left */}
              <div
                className="absolute z-10 w-[220px] rounded-[14px] bg-white p-[14px_16px] animate-fade-in-up"
                style={{
                  bottom: -20,
                  left: -20,
                  border: "0.5px solid #e4e0d8",
                  boxShadow: "0 4px 24px rgba(0,0,0,0.10)",
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    RS
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#1C1B1A]">Ranim S.</p>
                    <p className="text-[10px] text-[#9a9590]">HR Specialist · Egypt</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[14px] font-bold text-[#FE6E3E]">$1,000/mo</span>
                  <span className="flex items-center gap-1 text-[10px] text-green-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    Available now
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-[7px] rounded-[6px] bg-[#f8f6f2] px-2 py-1.5" style={{ border: "0.5px solid #e4e0d8" }}>
                  <div className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#FE6E3E]">
                    <svg className="w-[6px] h-[6px] text-white ml-[1px]" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                  <span className="text-[9px] text-[#9a9590]">Voice recording</span>
                  <div className="ml-auto">
                    <WaveformBars size="lg" />
                  </div>
                </div>
              </div>

              {/* Floating card — top right */}
              <div
                className="absolute z-10 w-[180px] rounded-[14px] bg-white p-[12px_14px] animate-fade-in-up"
                style={{
                  top: 20,
                  right: -20,
                  border: "0.5px solid #e4e0d8",
                  boxShadow: "0 4px 24px rgba(0,0,0,0.10)",
                  animationDelay: "0.2s",
                }}
              >
                <p className="text-[12px] font-semibold text-[#1C1B1A]">Shelly G.</p>
                <p className="text-[9px] text-[#9a9590]">Philippines</p>
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-[13px] font-bold text-[#FE6E3E]">$1,500/mo</span>
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <span className="rounded-full px-2 py-0.5 text-[9px] font-medium" style={{ background: "rgba(254,110,62,0.10)", color: "#FE6E3E" }}>
                    Exceptional
                  </span>
                </div>
                <p className="mt-1 text-[9px] text-[#9a9590]">Social Media Manager</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
