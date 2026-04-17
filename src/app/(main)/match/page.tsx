"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

interface MatchResult {
  id: string;
  display_name: string;
  country: string;
  role_category: string;
  hourly_rate: number;
  english_written_tier: string | null;
  bio: string | null;
  profile_photo_url: string | null;
  reputation_tier: string | null;
  video_intro_status: string | null;
  match_score: number;
}

function MatchPageContent() {
  const searchParams = useSearchParams();
  const prefilled = searchParams.get("q") || "";

  const [query, setQuery] = useState(prefilled);
  const [results, setResults] = useState<MatchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  // Auto-search if query came from landing page
  useEffect(() => {
    if (prefilled.trim()) {
      handleSearch();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError("");
    setSearched(false);

    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
      } else {
        setResults(data.results || []);
      }
    } catch {
      setError("Failed to find matches. Please try again.");
    }

    setSearched(true);
    setLoading(false);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-text">
          {searched && results.length > 0 ? "Your top matches" : "Find your perfect match"}
        </h1>
        <p className="mt-2 text-text-muted">
          {searched && results.length > 0
            ? "Ranked by compatibility with what you described."
            : "Describe what you need. We'll find who can do it."}
        </p>
      </div>

      {/* Search input */}
      {(!searched || results.length === 0) && (
        <form onSubmit={handleSearch} className="mx-auto max-w-2xl">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={3}
            placeholder="Describe what you need. Tell us the work, the role, and anything that matters to you. We'll find your best matches."
            className="w-full rounded-xl border border-border bg-white px-5 py-4 text-sm text-text placeholder-text-tertiary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
          />
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="mt-4 w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            {loading ? "Finding matches..." : "Find My Matches"}
          </button>
        </form>
      )}

      {/* Loading */}
      {loading && (
        <div className="mt-12 text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-3 border-primary border-t-transparent" />
          <p className="mt-4 text-sm text-text-muted">Analyzing your requirements and matching candidates...</p>
        </div>
      )}

      {/* Results */}
      {searched && !loading && results.length > 0 && (
        <>
          <p className="mt-2 text-center text-xs text-text-tertiary mb-6">
            {results.length} match{results.length !== 1 ? "es" : ""} found in seconds
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((c) => {
              const scoreColor = c.match_score >= 80 ? "border-primary text-primary" : c.match_score >= 60 ? "border-amber-500 text-amber-600" : "border-gray-300 text-gray-400";

              return (
                <Link
                  key={c.id}
                  href={`/candidate/${c.id}`}
                  className="group rounded-2xl border border-border-light bg-card hover:border-text/20 transition-colors p-5 relative"
                >
                  {/* Match score circle */}
                  <div className={`absolute top-4 right-4 flex h-12 w-12 items-center justify-center rounded-full border-2 ${scoreColor}`}>
                    <div className="text-center">
                      <span className="text-sm font-bold">{c.match_score}%</span>
                    </div>
                  </div>
                  <p className="absolute top-[60px] right-4 text-[9px] text-text-tertiary text-center w-12">Match</p>

                  {/* Card content */}
                  <div className="flex items-start gap-3 pr-14">
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-background">
                      {c.profile_photo_url ? (
                        <img src={c.profile_photo_url} alt={c.display_name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-text-tertiary">
                          {c.display_name?.[0] || "?"}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-sm font-semibold text-text truncate">{c.display_name}</h3>
                        {c.reputation_tier === "Elite" && (
                          <span className="rounded-full bg-amber-700 px-1.5 py-0.5 text-[9px] font-bold text-amber-100">Elite</span>
                        )}
                        {c.reputation_tier === "Top Rated" && (
                          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-white">Top Rated</span>
                        )}
                      </div>
                      <p className="text-xs text-text-tertiary">{c.country} &middot; {c.role_category}</p>
                    </div>
                  </div>

                  {/* Rate */}
                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-base font-semibold text-text">
                      ${c.hourly_rate}<span className="text-xs font-normal text-text-tertiary">/hr</span>
                    </p>
                    {c.video_intro_status === "approved" && (
                      <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                      </svg>
                    )}
                  </div>

                  {/* Badges */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.english_written_tier && (
                      <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                        {c.english_written_tier.charAt(0).toUpperCase() + c.english_written_tier.slice(1)}
                      </span>
                    )}
                  </div>

                  {/* Bio */}
                  {c.bio && (
                    <p className="mt-2 text-[13px] leading-relaxed text-text-muted line-clamp-2">{c.bio}</p>
                  )}
                </Link>
              );
            })}
          </div>

          {/* Refine search */}
          <div className="mt-8 text-center">
            <button
              onClick={() => { setSearched(false); setResults([]); }}
              className="text-sm text-primary hover:underline"
            >
              Not what you were looking for? Refine your search &rarr;
            </button>
          </div>
        </>
      )}

      {/* No results */}
      {searched && !loading && results.length === 0 && (
        <div className="mt-12 text-center">
          <svg className="mx-auto h-12 w-12 text-text-tertiary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <p className="mt-3 text-text-muted">No matches found for your description.</p>
          <p className="mt-1 text-xs text-text-tertiary">Try being more specific about the role or skills you need.</p>
          <button
            onClick={() => { setSearched(false); setResults([]); }}
            className="mt-4 text-sm text-primary hover:underline"
          >
            Try a different search
          </button>
        </div>
      )}
    </div>
  );
}

export default function MatchPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}>
      <MatchPageContent />
    </Suspense>
  );
}
