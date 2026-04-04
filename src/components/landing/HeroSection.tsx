"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface HeroCandidate {
  id: string;
  display_name: string;
  role_category: string;
  hourly_rate: number;
  english_written_tier: string | null;
  country: string;
  profile_photo_url: string | null;
}

interface Props {
  heroPreview: HeroCandidate[];
}

export default function HeroSection({ heroPreview: _heroPreview }: Props) {
  const [query, setQuery] = useState("");
  const router = useRouter();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(query.trim() ? `/browse?search=${encodeURIComponent(query.trim())}` : "/browse");
  }

  return (
    <section className="relative bg-card overflow-hidden">
      <div className="mx-auto max-w-4xl px-6 pt-24 pb-20 sm:pt-32 sm:pb-28 lg:pt-40 lg:pb-36 text-center">

        <h1 className="text-[2.75rem] sm:text-6xl lg:text-7xl font-semibold leading-[1.05] tracking-tight text-text">
          Talent you can
          <br />
          <span className="text-primary">hear before you hire.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-lg sm:text-xl text-text-muted leading-relaxed">
          Paralegals, bookkeepers, and admin professionals — vetted with live
          English assessments and voice recordings you can listen to before
          you reach out.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/browse"
            className="rounded-full bg-primary px-8 py-3.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
          >
            Browse
          </Link>
          <Link
            href="/apply"
            className="rounded-full border border-border px-8 py-3.5 text-sm font-semibold text-text hover:border-text transition-colors"
          >
            Apply
          </Link>
        </div>

        <form onSubmit={handleSearch} className="mx-auto mt-10 flex max-w-md gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search by role — "paralegal", "bookkeeper"'
            className="flex-1 rounded-full border border-border-light bg-background px-5 py-3 text-sm text-text placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
          />
          <button
            type="submit"
            className="rounded-full bg-charcoal px-5 py-3 text-sm font-medium text-white hover:bg-charcoal/90 transition-colors"
          >
            Search
          </button>
        </form>

        <p className="mt-8 text-xs text-text-tertiary tracking-wide">
          Free to browse · Escrow-protected payments · No fees for candidates
        </p>
      </div>
    </section>
  );
}
