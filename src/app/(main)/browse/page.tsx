"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import CandidateCard, { CandidateCardSkeleton } from "@/components/browse/CandidateCard";
import { createClient } from "@/lib/supabase/client";

const ROLE_CATEGORIES = [
  "All",
  "Paralegal",
  "Legal Assistant",
  "Bookkeeping/AP",
  "Admin",
  "VA",
  "Cold Caller",
  "Sales",
  "SDR",
  "SEO",
  "Marketing",
  "Scheduling",
  "Customer Support",
  "Medical",
  "E-Commerce",
];

const TIER_OPTIONS = [
  { value: "any", label: "Any English Level" },
  { value: "exceptional", label: "Exceptional" },
  { value: "advanced", label: "Advanced" },
  { value: "professional", label: "Professional" },
];

const SPEAKING_OPTIONS = [
  { value: "any", label: "Any Speaking Level" },
  { value: "fluent", label: "Fluent" },
  { value: "proficient", label: "Proficient" },
  { value: "conversational", label: "Conversational" },
  { value: "developing", label: "Developing" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest First" },
  { value: "rate_low", label: "Rate: Low to High" },
  { value: "rate_high", label: "Rate: High to Low" },
  { value: "earnings", label: "Most Earned" },
  { value: "tier", label: "English Tier" },
];

interface CandidateResult {
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
  needs_availability_update: boolean;
  voice_recording_1_preview_url: string | null;
}

function BrowseContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [candidates, setCandidates] = useState<CandidateResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Initialize from URL params
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [role, setRole] = useState(searchParams.get("role") || "All");
  const [country, setCountry] = useState("");
  const [minRate, setMinRate] = useState(0);
  const [maxRate, setMaxRate] = useState(150);
  const [availability, setAvailability] = useState(
    searchParams.get("availability") || ""
  );
  const [tier, setTier] = useState("any");
  const [speakingLevel, setSpeakingLevel] = useState("any");
  const [usExperience, setUsExperience] = useState("");
  // lockStatus removed — availability computed from committed_hours
  const [sort, setSort] = useState("newest");
  const [showFilters, setShowFilters] = useState(false);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();

    if (search) params.set("search", search);
    if (role && role !== "All") params.set("role", role);
    if (country) params.set("country", country);
    if (minRate > 0) params.set("minRate", minRate.toString());
    if (maxRate < 150) params.set("maxRate", maxRate.toString());
    if (availability) params.set("availability", availability);
    if (tier !== "any") params.set("tier", tier);
    if (speakingLevel !== "any") params.set("speakingLevel", speakingLevel);
    if (usExperience) params.set("usExperience", usExperience);
    // lockStatus removed
    params.set("sort", sort);
    params.set("page", page.toString());

    const res = await fetch(`/api/candidates?${params}`);
    const data = await res.json();

    setCandidates(data.candidates || []);
    setTotal(data.total || 0);
    setTotalPages(data.totalPages || 1);
    setLoading(false);
  }, [search, role, country, minRate, maxRate, availability, tier, speakingLevel, usExperience, sort, page]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  // Check auth state
  useEffect(() => {
    async function checkAuth() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      setIsLoggedIn(!!session);
    }
    checkAuth();
  }, []);

  function resetFilters() {
    setSearch("");
    setRole("All");
    setCountry("");
    setMinRate(0);
    setMaxRate(150);
    setAvailability("");
    setTier("any");
    setSpeakingLevel("any");
    setUsExperience("");
    // lockStatus removed
    setSort("newest");
    setPage(1);
    router.replace("/browse");
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    fetchCandidates();
  }

  const activeFilterCount = [
    role !== "All",
    country,
    minRate > 0,
    maxRate < 150,
    availability,
    tier !== "any",
    speakingLevel !== "any",
    usExperience,
  ].filter(Boolean).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Search header */}
      <div className="border-b border-border-light bg-card">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <form onSubmit={handleSearch} className="flex gap-2 max-w-xl">
            <div className="relative flex-1">
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder='Search by role, name, or country'
                className="w-full rounded-full border border-border-light bg-background pl-11 pr-4 py-3 text-sm text-text placeholder-text-tertiary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
              />
            </div>
            <button type="submit" className="rounded-full bg-charcoal px-5 py-3 text-sm font-medium text-white hover:bg-charcoal/90 transition-colors">
              Search
            </button>
          </form>

          {/* Role pills */}
          <div className="mt-5 flex flex-wrap gap-2">
            {ROLE_CATEGORIES.map((r) => (
              <button
                key={r}
                onClick={() => { setRole(r); setPage(1); }}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  role === r
                    ? "bg-text text-white"
                    : "bg-transparent text-text-secondary hover:text-text border border-border-light"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <p className="text-sm text-text-muted">
              <span className="font-semibold text-text">{total}</span>{" "}
              {total === 1 ? "result" : "results"}
              {search && (
                <span>
                  {" "}matching &ldquo;<span className="text-primary">{search}</span>&rdquo;
                </span>
              )}
              {role !== "All" && (
                <span>
                  {" "}in <span className="text-primary">{role}</span>
                </span>
              )}
            </p>
            {(search || activeFilterCount > 0) && (
              <button
                onClick={resetFilters}
                className="text-xs text-primary hover:text-primary-dark font-medium"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Mobile filter toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-text hover:bg-gray-50 lg:hidden min-h-[44px]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filters
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>

            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6 flex gap-8">
          {/* Mobile bottom sheet backdrop */}
          {showFilters && (
            <div
              className="fixed inset-0 z-40 bg-black/40 lg:hidden"
              onClick={() => setShowFilters(false)}
            />
          )}

          {/* Filters sidebar / mobile bottom sheet */}
          <aside
            className={`${
              showFilters ? "translate-y-0" : "translate-y-full"
            } fixed bottom-0 left-0 right-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-card shadow-2xl transition-transform duration-300 lg:translate-y-0 lg:relative lg:z-auto lg:max-h-none lg:rounded-xl lg:shadow-none lg:block w-full lg:w-64 lg:shrink-0`}
          >
            {/* Mobile drag handle */}
            <div
              className="sticky top-0 z-10 flex justify-center bg-card pt-3 pb-2 lg:hidden cursor-pointer min-h-[44px] items-center"
              onClick={() => setShowFilters(false)}
            >
              <div className="h-1 w-10 rounded-full bg-gray-300" />
            </div>

            <div className="space-y-5 p-5 lg:sticky lg:top-24 lg:rounded-xl lg:border lg:border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text">Filters</h2>
                <button
                  onClick={resetFilters}
                  className="text-xs text-primary hover:text-primary-dark font-medium"
                >
                  Reset
                </button>
              </div>

              {/* Country */}
              <div>
                <label className="block text-xs font-medium text-text/50 mb-1.5">
                  Country
                </label>
                <input
                  type="text"
                  value={country}
                  onChange={(e) => {
                    setCountry(e.target.value);
                    setPage(1);
                  }}
                  placeholder="e.g. Philippines"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Hourly Rate */}
              <div>
                <label className="block text-xs font-medium text-text/50 mb-1.5">
                  Hourly Rate (USD)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={minRate || ""}
                    onChange={(e) => {
                      setMinRate(parseInt(e.target.value) || 0);
                      setPage(1);
                    }}
                    placeholder="Min"
                    className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-text/30">&ndash;</span>
                  <input
                    type="number"
                    min={0}
                    value={maxRate >= 150 ? "" : maxRate}
                    onChange={(e) => {
                      setMaxRate(parseInt(e.target.value) || 150);
                      setPage(1);
                    }}
                    placeholder="Max"
                    className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Availability */}
              <div>
                <label className="block text-xs font-medium text-text/50 mb-1.5">
                  Availability
                </label>
                <select
                  value={availability}
                  onChange={(e) => {
                    setAvailability(e.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">All</option>
                  <option value="available">Available Now</option>
                  <option value="partially_available">Partially Available</option>
                </select>
              </div>

              {/* English Written Tier */}
              <div>
                <label className="block text-xs font-medium text-text/50 mb-1.5">
                  English Written
                </label>
                <select
                  value={tier}
                  onChange={(e) => {
                    setTier(e.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {TIER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Speaking Level */}
              <div>
                <label className="block text-xs font-medium text-text/50 mb-1.5">
                  Speaking Level
                </label>
                <select
                  value={speakingLevel}
                  onChange={(e) => {
                    setSpeakingLevel(e.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {SPEAKING_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* US Experience */}
              <div>
                <label className="block text-xs font-medium text-text/50 mb-1.5">
                  US Client Experience
                </label>
                <select
                  value={usExperience}
                  onChange={(e) => {
                    setUsExperience(e.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Any</option>
                  <option value="yes">Has US Experience</option>
                  <option value="no">No US Experience</option>
                </select>
              </div>

              {/* Lock status checkbox removed — availability now computed from committed_hours */}

              {/* Mobile apply button */}
              <button
                onClick={() => setShowFilters(false)}
                className="mt-4 w-full rounded-lg bg-primary py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors lg:hidden min-h-[44px]"
              >
                Apply Filters
              </button>
            </div>
          </aside>

          {/* Candidate grid */}
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <CandidateCardSkeleton key={i} />
                ))}
              </div>
            ) : candidates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24">
                <p className="text-lg font-semibold text-text">No matches</p>
                <p className="mt-2 text-sm text-text-muted">
                  Try a different search or adjust your filters.
                </p>
                <button
                  onClick={resetFilters}
                  className="mt-6 rounded-full border border-border px-6 py-2.5 text-sm font-medium text-text hover:border-text transition-colors"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                  {candidates.map((candidate) => (
                    <CandidateCard key={candidate.id} candidate={candidate} isLoggedIn={isLoggedIn} />
                  ))}
                </div>

                {/* Soft nudge */}
                {candidates.length >= 12 && page === 1 && (
                  <div className="mt-10 py-8 text-center">
                    <p className="text-sm text-text-muted">
                      Sign up to message anyone on StaffVA. It&apos;s free.
                    </p>
                    <a
                      href="/signup/client"
                      className="mt-3 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
                    >
                      Create free account
                    </a>
                  </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="mt-8 flex items-center justify-center gap-3">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-text hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      &larr; Previous
                    </button>
                    <span className="text-sm text-text/50">
                      Page {page} of {totalPages}
                    </span>
                    <button
                      onClick={() =>
                        setPage((p) => Math.min(totalPages, p + 1))
                      }
                      disabled={page === totalPages}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-text hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Next &rarr;
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BrowsePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <p className="text-text/60">Loading...</p>
        </div>
      }
    >
      <BrowseContent />
    </Suspense>
  );
}
