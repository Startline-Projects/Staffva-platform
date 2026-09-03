"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

import CandidatePreviewPanel from "@/components/browse/CandidatePreviewPanel";
import AtlasNav from "@/components/landing/AtlasNav";
import AtlasFooter from "@/components/landing/AtlasFooter";
import LandingInteractive from "@/components/landing/LandingInteractive";
import "@/app/landing.css";

import { createClient } from "@/lib/supabase/client";

const FLAGS: Record<string, string> = {
  Philippines: "🇵🇭", India: "🇮🇳", Egypt: "🇪🇬", Kenya: "🇰🇪", Nigeria: "🇳🇬",
  Pakistan: "🇵🇰", Colombia: "🇨🇴", Argentina: "🇦🇷", Mexico: "🇲🇽", Brazil: "🇧🇷",
};

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

interface CandidateResult {
  id: string;
  display_name: string;
  country: string;
  role_category: string;
  hourly_rate: number;
  english_written_tier: string | null;
  availability_status: string;
  us_client_experience: string | null;
  bio: string | null;
  total_earnings_usd: number;
  committed_hours: number;
  profile_photo_url: string | null;
  needs_availability_update: boolean;
  voice_recording_1_preview_url: string | null;
  tagline?: string | null;
  skills?: string[] | null;
  video_intro_status?: string | null;
  video_intro_thumbnail_url?: string | null;
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
  const [skillAggregation, setSkillAggregation] = useState<{ skill: string; count: number }[]>([]);
  const [showAllSkills, setShowAllSkills] = useState(false);

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
  const [usExperience, setUsExperience] = useState("");
  // lockStatus removed — availability computed from committed_hours
  const [sort, setSort] = useState("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [aiQuery, setAiQuery] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiApplied, setAiApplied] = useState<string[]>([]);
  const [aiError, setAiError] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [skillFilters, setSkillFilters] = useState<string[]>(() => {
    const s = searchParams.get("skills");
    return s ? s.split(",").map((x) => decodeURIComponent(x.trim())).filter(Boolean) : [];
  });

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
    if (usExperience) params.set("usExperience", usExperience);
    if (skillFilters.length > 0) params.set("skills", skillFilters.join(","));
    params.set("sort", sort);
    params.set("page", page.toString());

    // Update URL without navigation
    const urlParams = new URLSearchParams();
    if (search) urlParams.set("search", search);
    if (role && role !== "All") urlParams.set("role", role);
    if (availability) urlParams.set("availability", availability);
    if (skillFilters.length > 0) urlParams.set("skills", skillFilters.join(","));
    const newUrl = urlParams.toString() ? `/browse?${urlParams}` : "/browse";
    window.history.replaceState(null, "", newUrl);

    // An outage must render as an outage — falling through to an empty list
    // showed "No matches" during API failures, an outage dressed as an
    // empty marketplace.
    try {
      setFetchError(false);
      const res = await fetch(`/api/candidates?${params}`);
      if (!res.ok) throw new Error(`candidates ${res.status}`);
      const data = await res.json();
      setCandidates(data.candidates || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
      setSkillAggregation(data.skillAggregation || []);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [search, role, country, minRate, maxRate, availability, tier, usExperience, skillFilters, sort, page]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  function toggleSkillFilter(skill: string) {
    setSkillFilters((prev) =>
      prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill]
    );
    setPage(1);
  }

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const autocompleteTimer = useRef<NodeJS.Timeout | null>(null);

  function handleSearchInput(value: string) {
    setSearch(value);
    if (autocompleteTimer.current) clearTimeout(autocompleteTimer.current);
    if (value.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    autocompleteTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/candidates/autocomplete?q=${encodeURIComponent(value.trim())}`);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setSuggestions(data);
          setShowSuggestions(true);
        } else {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      } catch {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 200);
  }

  function selectSuggestion(value: string) {
    setSearch(value);
    setSuggestions([]);
    setShowSuggestions(false);
    setPage(1);
  }

  // Check auth state
  useEffect(() => {
    async function checkAuth() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      setIsLoggedIn(!!session);
    }
    checkAuth();
  }, []);

  // Plain-words search: the server parses the sentence into the SAME filter
  // state the controls below set — the model never sees or ranks candidates,
  // it only translates words into clicks.
  async function runAiSearch() {
    const q = aiQuery.trim();
    if (q.length < 3 || aiBusy) return;
    setAiBusy(true);
    setAiError("");
    try {
      const res = await fetch("/api/browse/ai-filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data.error || "Try rewording that.");
        return;
      }
      const f = data.filters || {};
      const applied: string[] = [];
      if (f.role) { setRole(f.role); applied.push(f.role); }
      if (f.country) { setCountry(f.country); applied.push(f.country); }
      if (f.min_rate !== null && f.min_rate !== undefined) { setMinRate(f.min_rate); applied.push(`≥ $${f.min_rate}/hr`); }
      if (f.max_rate !== null && f.max_rate !== undefined) { setMaxRate(f.max_rate); applied.push(`≤ $${f.max_rate}/hr`); }
      if (f.availability) { setAvailability(f.availability); applied.push(f.availability === "available" ? "Available now" : "Partially available"); }
      if (f.tier) { setTier(f.tier); applied.push(`English: ${f.tier}`); }
      if (f.us_experience) { setUsExperience(f.us_experience); applied.push("US experience"); }
      if (Array.isArray(f.skills) && f.skills.length) { setSkillFilters(f.skills); applied.push(...f.skills); }
      if (f.search_terms) { setSearch(f.search_terms); applied.push(`“${f.search_terms}”`); }
      setPage(1);
      setAiApplied(applied);
      if (applied.length === 0) setAiError("That search did not map to any filters — try naming a role, rate, or skill.");
    } catch {
      setAiError("Could not reach the server.");
    } finally {
      setAiBusy(false);
    }
  }

  function resetFilters() {
    setSearch("");
    setRole("All");
    setCountry("");
    setMinRate(0);
    setMaxRate(150);
    setAvailability("");
    setTier("any");
    setUsExperience("");
    setAiApplied([]);
    setAiQuery("");
    setAiError("");
    // lockStatus removed
    setSort("newest");
    setPage(1);
    setShowAllSkills(false);
    router.replace("/browse");
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setShowSuggestions(false);
    fetchCandidates();
  }

  const activeFilterCount = [
    role !== "All",
    country,
    minRate > 0,
    maxRate < 150,
    availability,
    tier !== "any",
    usExperience,
  ].filter(Boolean).length;

  return (
    <div className="lp">
      {/* Same landing faces as the homepage — the inner app keeps its own fonts. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Geist:wght@300..900&family=Geist+Mono:wght@400..600&display=swap"
        rel="stylesheet"
      />
      <AtlasNav />
      <div className={previewId ? "md:mr-[480px]" : ""} style={{ transition: "margin .25s" }}>
        <section className="browse-top">
          <div className="container">
            <div className="browse-header">
              <div>
                <h1>
                  Browse <span className="count">{total.toLocaleString()}</span> vetted A-players
                </h1>
              </div>
              <div className="browse-subactions">
                <button className="mobile-filter-trigger" onClick={() => setShowFilters(!showFilters)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>
                  Filters
                  {activeFilterCount > 0 && (
                    <span style={{ background: "var(--ink)", color: "var(--paper)", padding: "1px 6px", borderRadius: "999px", fontSize: "10px", marginLeft: "4px" }}>{activeFilterCount}</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>

        <div className="container browse-layout">
          {/* ── Filters sidebar ── */}
          <aside className={`filters ${showFilters ? "open" : ""}`} id="filters">
            <div className="filters-top">
              <div className="filters-title">Filters</div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button className="filters-clear" onClick={resetFilters}>Clear all</button>
                <button className="filters-close" onClick={() => setShowFilters(false)} aria-label="Close filters">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            </div>

            {/* Plain-words search — parses into the real filters below */}
            <div className="filter-group">
              <div className="filter-label">Describe who you need</div>
              <input
                type="text"
                className="filter-input"
                value={aiQuery}
                onChange={(e) => setAiQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runAiSearch(); }}
                placeholder="Legal assistant under $12, knows Clio"
              />
              <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: "8px", padding: "9px 14px", fontSize: "13px" }} onClick={runAiSearch} disabled={aiBusy}>
                {aiBusy ? "Reading…" : "Set filters"}
              </button>
              {aiApplied.length > 0 && (
                <div className="filter-chips" style={{ marginTop: "8px" }}>
                  {aiApplied.map((a) => (<span key={a} className="filter-chip active">{a}</span>))}
                </div>
              )}
              {aiError && <p style={{ color: "#b3261e", fontSize: "12px", marginTop: "6px" }}>{aiError}</p>}
            </div>

            <div className="filter-group">
              <div className="filter-label">Role category</div>
              <div className="filter-chips">
                {ROLE_CATEGORIES.map((r) => (
                  <button key={r} className={`filter-chip ${role === r ? "active" : ""}`} onClick={() => { setRole(r); setPage(1); }}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-group">
              <div className="filter-label">Core skills</div>
              {skillFilters.length > 0 && (
                <div className="filter-chips" style={{ marginBottom: "8px" }}>
                  {skillFilters.map((sk) => (
                    <button key={sk} className="filter-chip active" onClick={() => toggleSkillFilter(sk)}>{sk} ✕</button>
                  ))}
                </div>
              )}
              {skillAggregation.length > 0 && (
                <div className="filter-chips">
                  {skillAggregation.slice(0, showAllSkills ? 15 : 6).map((sa) => (
                    <button key={sa.skill} className={`filter-chip ${skillFilters.includes(sa.skill) ? "active" : ""}`} onClick={() => toggleSkillFilter(sa.skill)}>
                      {sa.skill} <span style={{ opacity: 0.55 }}>{sa.count}</span>
                    </button>
                  ))}
                  {skillAggregation.length > 6 && (
                    <button className="filter-chip" onClick={() => setShowAllSkills(!showAllSkills)}>
                      {showAllSkills ? "less" : `+ ${skillAggregation.length - 6} more`}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="filter-group">
              <div className="filter-label">Hourly rate</div>
              <div className="range-display">
                <span>${minRate}</span>
                <span>{maxRate >= 150 ? "$150+" : `$${maxRate}`}</span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <input type="number" className="filter-input" min={0} max={150} value={minRate || ""} placeholder="Min" onChange={(e) => { setMinRate(Number(e.target.value) || 0); setPage(1); }} />
                <input type="number" className="filter-input" min={0} max={150} value={maxRate < 150 ? maxRate : ""} placeholder="Max" onChange={(e) => { setMaxRate(Number(e.target.value) || 150); setPage(1); }} />
              </div>
            </div>

            <div className="filter-group">
              <div className="filter-label">Availability</div>
              <div className="filter-chips">
                <button className={`filter-chip ${availability === "" ? "active" : ""}`} onClick={() => { setAvailability(""); setPage(1); }}>All</button>
                <button className={`filter-chip ${availability === "available" ? "active" : ""}`} onClick={() => { setAvailability("available"); setPage(1); }}>Available now</button>
                <button className={`filter-chip ${availability === "partially_available" ? "active" : ""}`} onClick={() => { setAvailability("partially_available"); setPage(1); }}>Partial</button>
              </div>
            </div>

            <div className="filter-group">
              <div className="filter-label">English level</div>
              <div className="filter-chips">
                {[["any", "Any"], ["exceptional", "Exceptional"], ["advanced", "Advanced"], ["professional", "Professional"]].map(([v, lbl]) => (
                  <button key={v} className={`filter-chip ${tier === v ? "active" : ""}`} onClick={() => { setTier(v); setPage(1); }}>{lbl}</button>
                ))}
              </div>
            </div>

            <div className="filter-group">
              <div className="filter-label">US client experience</div>
              <div className="filter-chips">
                <button className={`filter-chip ${usExperience === "" ? "active" : ""}`} onClick={() => { setUsExperience(""); setPage(1); }}>Any</button>
                <button className={`filter-chip ${usExperience === "yes" ? "active" : ""}`} onClick={() => { setUsExperience("yes"); setPage(1); }}>Has US experience</button>
              </div>
            </div>

            <div className="filter-group">
              <div className="filter-label">Country</div>
              <input type="text" className="filter-input" value={country} placeholder="e.g. Philippines" onChange={(e) => { setCountry(e.target.value); setPage(1); }} />
            </div>
          </aside>

          {/* ── Results ── */}
          <div className="results">
            <div className="results-top">
              <form className="results-search" onSubmit={handleSearch} style={{ position: "relative" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder="Search by keyword, skill, or role…"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "10px", marginTop: "4px", zIndex: 30, overflow: "hidden" }}>
                    {suggestions.map((sug) => (
                      <button key={sug} type="button" style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 14px", fontSize: "13px", background: "none", border: "none", cursor: "pointer" }} onMouseDown={() => selectSuggestion(sug)}>
                        {sug}
                      </button>
                    ))}
                  </div>
                )}
              </form>
              <select className="results-select" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
                <option value="newest">Sort: Newest</option>
                <option value="rate_low">Rate: Low → High</option>
                <option value="rate_high">Rate: High → Low</option>
                <option value="earnings">Most earned</option>
                <option value="tier">English level</option>
              </select>
            </div>

            <div className="results-count">
              {loading ? "Checking the bench…" : (
                <>Showing <strong>{candidates.length ? (page - 1) * 24 + 1 : 0}–{(page - 1) * 24 + candidates.length}</strong> of <strong>{total.toLocaleString()}</strong> matches</>
              )}
            </div>

            {fetchError ? (
              <div style={{ padding: "64px 0", textAlign: "center" }}>
                <p style={{ fontWeight: 600 }}>Couldn&apos;t load candidates</p>
                <p style={{ fontSize: "13px", color: "var(--ink-mute)", marginTop: "6px" }}>Something went wrong on our side — your filters are fine.</p>
                <button className="btn btn-outline" style={{ marginTop: "16px" }} onClick={() => fetchCandidates()}>Try again</button>
              </div>
            ) : loading ? (
              <div style={{ padding: "64px 0", textAlign: "center", color: "var(--ink-mute)" }}>Loading…</div>
            ) : candidates.length === 0 ? (
              <div style={{ padding: "64px 0", textAlign: "center" }}>
                <p style={{ fontWeight: 600 }}>No matches</p>
                <p style={{ fontSize: "13px", color: "var(--ink-mute)", marginTop: "6px" }}>Try a different search or adjust your filters.</p>
                <button className="btn btn-outline" style={{ marginTop: "16px" }} onClick={resetFilters}>Clear filters</button>
              </div>
            ) : (
              <>
                <div className="results-grid reveal-stagger in">
                  {candidates.map((c) => {
                    const avail = !c.committed_hours || c.committed_hours === 0 ? "AVAILABLE NOW" : c.committed_hours < 40 ? "PARTIAL" : "BOOKED";
                    const tierLabel = c.english_written_tier ? c.english_written_tier.slice(0, 3).toUpperCase() : "—";
                    const hasUs = typeof c.us_client_experience === "string" && !["none", "international_only"].includes(c.us_client_experience);
                    // Video intro is optional. When an approved one exists the
                    // photo block becomes its doorway (thumbnail if we have
                    // one, else the profile photo, plus a play affordance);
                    // when it doesn't, the profile photo simply fills the
                    // block and nothing hints at a video.
                    const hasVideo = c.video_intro_status === "approved";
                    const photoBg = (hasVideo && c.video_intro_thumbnail_url) || c.profile_photo_url;
                    return (
                      <div
                        key={c.id}
                        className="result-card"
                        onClick={() => setPreviewId(c.id)}
                        role="button"
                        tabIndex={0}
                        aria-label={`Preview ${c.display_name}`}
                        // The target guard keeps Enter on the nested links
                        // (play, View Profile) from ALSO opening the preview
                        // — keydown bubbles even though their clicks stop
                        // propagation. Space is required for role="button"
                        // and must not scroll the page.
                        onKeyDown={(e) => {
                          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                            e.preventDefault();
                            setPreviewId(c.id);
                          }
                        }}
                      >
                        <div className="result-top">
                          <div className="result-photo" style={photoBg ? { backgroundImage: `url(${photoBg})`, backgroundSize: "cover", backgroundPosition: "center" } : { background: "linear-gradient(135deg, #2b4a3e 0%, #5a8b73 100%)" }}>
                            <div className="result-avail"><span className={`avail-dot ${avail === "AVAILABLE NOW" ? "avail-now" : ""}`}></span>{avail}</div>
                            {hasVideo && !isLoggedIn && (
                              <div className="result-video-lock" aria-hidden>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                              </div>
                            )}
                            {hasVideo && (
                              <a href={`/candidate/${c.id}`} className="result-play" aria-label={`Watch ${c.display_name}'s video intro`} onClick={(e) => e.stopPropagation()}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="8 5 19 12 8 19" /></svg>
                              </a>
                            )}
                            <div className="result-flag">{FLAGS[c.country || ""] || "🌍"}</div>
                          </div>
                        </div>
                        <div className="result-name-row">
                          <div className="result-name">{c.display_name}
                            <span className="result-verify"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><polyline points="20 6 9 17 4 12" /></svg></span>
                          </div>
                        </div>
                        <div className="result-role">{c.tagline || c.role_category}</div>
                        <div className="result-location">{c.country}</div>
                        <div className="result-tags">
                          {(c.skills || []).slice(0, 3).map((sk) => (<span key={sk} className="result-tag">{sk}</span>))}
                        </div>
                        <div className="result-badges">
                          <div className="result-badge"><div className="result-badge-val">{tierLabel}</div><div className="result-badge-lbl">English</div></div>
                          <div className="result-badge"><div className="result-badge-val">{hasUs ? "US ✓" : "—"}</div><div className="result-badge-lbl">US exp</div></div>
                          <div className="result-badge"><div className="result-badge-val green">ID ✓</div><div className="result-badge-lbl">Verified</div></div>
                        </div>
                        <div className="result-bottom">
                          <div className="result-rate">${Number(c.hourly_rate)}<span>/hr</span></div>
                          <a href={`/candidate/${c.id}`} className="result-view" onClick={(e) => e.stopPropagation()}>View Profile
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {totalPages > 1 && (
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "14px", marginTop: "36px" }}>
                    <button className="btn btn-outline" disabled={page <= 1} onClick={() => setPage(page - 1)} style={page <= 1 ? { opacity: 0.4 } : undefined}>← Previous</button>
                    <span style={{ fontSize: "13px", color: "var(--ink-mute)" }}>Page {page} of {totalPages}</span>
                    <button className="btn btn-outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)} style={page >= totalPages ? { opacity: 0.4 } : undefined}>Next →</button>
                  </div>
                )}

                {!isLoggedIn && candidates.length >= 12 && page === 1 && (
                  <div style={{ margin: "48px 0 8px", textAlign: "center" }}>
                    <p style={{ fontSize: "14px", color: "var(--ink-mute)" }}>Sign up to message anyone on StaffVA. It&apos;s free.</p>
                    <a href="/signup/client" className="btn btn-primary" style={{ marginTop: "12px" }}>Create free account</a>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <AtlasFooter />
      </div>

      <CandidatePreviewPanel
        candidateId={previewId}
        onClose={() => setPreviewId(null)}
        onSkillClick={toggleSkillFilter}
      />
      <LandingInteractive />
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
