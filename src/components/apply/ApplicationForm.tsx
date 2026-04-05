"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CandidateData } from "@/app/(main)/apply/page";

// ─── Countries by Region ───
const COUNTRY_GROUPS = [
  { label: "Middle East", countries: ["Bahrain", "Iraq", "Jordan", "Kuwait", "Lebanon", "Oman", "Palestine", "Qatar", "Saudi Arabia", "Syria", "United Arab Emirates", "Yemen"] },
  { label: "South Asia", countries: ["Bangladesh", "India", "Nepal", "Pakistan", "Sri Lanka"] },
  { label: "North Africa", countries: ["Algeria", "Egypt", "Libya", "Morocco", "Tunisia"] },
  { label: "South America", countries: ["Argentina", "Bolivia", "Brazil", "Chile", "Colombia", "Ecuador", "Paraguay", "Peru", "Uruguay", "Venezuela"] },
  { label: "Other", countries: ["Ghana", "Indonesia", "Kenya", "Nigeria", "Philippines", "South Africa", "Turkey", "Other"] },
];

// ─── Role Categories ───
const ROLE_CATEGORIES = [
  { group: "Legal", roles: ["Paralegal", "Legal Assistant", "Legal Secretary", "Litigation Support", "Contract Reviewer"] },
  { group: "Accounting & Finance", roles: ["Bookkeeper", "Accounts Payable Specialist", "Accounts Receivable Specialist", "Payroll Specialist", "Tax Preparer", "Financial Analyst"] },
  { group: "Administrative", roles: ["Administrative Assistant", "Executive Assistant", "Virtual Assistant", "Office Manager", "Data Entry Specialist"] },
  { group: "Scheduling & Support", roles: ["Scheduling Coordinator", "Customer Support Representative"] },
  { group: "Medical", roles: ["Medical Billing Specialist", "Medical Administrative Assistant", "Insurance Verification Specialist", "Dental Office Administrator"] },
  { group: "Real Estate", roles: ["Real Estate Assistant", "Transaction Coordinator"] },
  { group: "HR & Recruitment", roles: ["HR Assistant", "Recruitment Coordinator"] },
  { group: "Creative & Marketing", roles: ["Social Media Manager", "Content Writer", "Graphic Designer", "Video Editor"] },
  { group: "Operations & E-commerce", roles: ["Project Manager", "Operations Assistant", "E-commerce Assistant", "Amazon Store Manager", "Shopify Assistant"] },
  { group: "Other", roles: ["Other"] },
];

const TOOLS_SUGGESTIONS = ["Microsoft Office", "Google Workspace", "Zoom", "Slack", "Asana", "Trello", "Notion", "HubSpot", "Salesforce", "QuickBooks", "Clio", "Excel", "Canva", "Adobe"];

const EXPERIENCE_OPTIONS = ["0-1", "1-3", "3-5", "5-10", "10+"];

const US_EXPERIENCE_OPTIONS = [
  { value: "full_time", label: "Yes, full time" },
  { value: "part_time_contract", label: "Yes, part time or contract" },
  { value: "international_only", label: "No, but I have worked with other international clients" },
  { value: "none", label: "No, this would be my first international role" },
];

// ─── Searchable Role Select ───
function SearchableRoleSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build flat list of all roles
  const allRoles = ROLE_CATEGORIES.flatMap((g) => g.roles.map((r) => ({ role: r, group: g.group })));

  // Filter by search
  const filtered = search.trim()
    ? allRoles.filter((r) => r.role.toLowerCase().includes(search.toLowerCase()) || r.group.toLowerCase().includes(search.toLowerCase()))
    : allRoles;

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Focus search when opened
  useEffect(() => {
    if (open && searchRef.current) searchRef.current.focus();
  }, [open]);

  // Reset highlight when search changes
  useEffect(() => { setHighlightIndex(-1); }, [search]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIndex((prev) => Math.min(prev + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIndex((prev) => Math.max(prev - 1, 0)); }
    if (e.key === "Enter" && highlightIndex >= 0 && filtered[highlightIndex]) {
      e.preventDefault();
      onChange(filtered[highlightIndex].role);
      setOpen(false);
      setSearch("");
    }
  }, [filtered, highlightIndex, onChange]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const el = listRef.current.children[highlightIndex] as HTMLElement;
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIndex]);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`mt-1 flex w-full items-center justify-between rounded-lg border px-4 py-3 text-sm text-left focus:outline-none focus:ring-1 ${
          open ? "border-primary ring-1 ring-primary" : "border-gray-300"
        } ${value ? "text-text" : "text-gray-400"}`}
      >
        <span className="truncate">{value || "Select your role"}</span>
        <svg className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* Backdrop for mobile */}
      {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Dropdown / bottom sheet */}
      {open && (
        <div
          className={`
            fixed bottom-0 left-0 right-0 z-50 max-h-[85vh] rounded-t-2xl bg-white shadow-2xl
            lg:absolute lg:top-full lg:bottom-auto lg:left-0 lg:right-0 lg:mt-1 lg:max-h-80 lg:rounded-xl lg:border lg:border-gray-200
          `}
          onKeyDown={handleKeyDown}
        >
          {/* Mobile drag handle */}
          <div className="flex justify-center pt-3 pb-1 lg:hidden">
            <div className="h-1 w-10 rounded-full bg-gray-300" />
          </div>

          {/* Search input */}
          <div className="px-3 pb-2 pt-1">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search roles..."
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-text placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Role list */}
          <div ref={listRef} className="overflow-y-auto px-1 pb-3" style={{ maxHeight: "calc(85vh - 100px)" }}>
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-gray-400">No roles found — try a different search.</p>
              </div>
            ) : (
              (() => {
                let currentGroup = "";
                return filtered.map((item, i) => {
                  const showGroup = item.group !== currentGroup;
                  currentGroup = item.group;
                  return (
                    <div key={`${item.group}-${item.role}`}>
                      {showGroup && (
                        <p className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{item.group}</p>
                      )}
                      <button
                        type="button"
                        onClick={() => { onChange(item.role); setOpen(false); setSearch(""); }}
                        className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                          i === highlightIndex ? "bg-primary/10 text-primary" : value === item.role ? "bg-gray-100 text-text font-medium" : "text-text hover:bg-gray-50"
                        }`}
                      >
                        {item.role}
                      </button>
                    </div>
                  );
                });
              })()
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tag Input Component ───
function TagInput({ tags, setTags, max, placeholder, suggestions }: {
  tags: string[]; setTags: (t: string[]) => void; max: number; placeholder: string; suggestions?: string[];
}) {
  const [input, setInput] = useState("");

  function addTag(tag: string) {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed) && tags.length < max) {
      setTags([...tags, trimmed]);
    }
    setInput("");
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map((tag) => (
          <span key={tag} className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            {tag}
            <button type="button" onClick={() => setTags(tags.filter((t) => t !== tag))} className="text-primary/60 hover:text-primary">×</button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(input); } if (e.key === "Backspace" && !input && tags.length) setTags(tags.slice(0, -1)); }}
        placeholder={tags.length >= max ? `Max ${max} reached` : placeholder}
        disabled={tags.length >= max}
        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
      />
      {suggestions && suggestions.length > 0 && tags.length < max && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {suggestions.filter((s) => !tags.includes(s)).slice(0, 6).map((s) => (
            <button key={s} type="button" onClick={() => addTag(s)} className="rounded-full border border-gray-200 px-2 py-0.5 text-[10px] text-text-muted hover:border-primary hover:text-primary transition-colors">
              + {s}
            </button>
          ))}
        </div>
      )}
      <p className="mt-1 text-xs text-gray-400">{tags.length}/{max}</p>
    </div>
  );
}

// ─── Progress Bar ───
function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="mb-8">
      <div className="flex justify-between mb-2">
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
              i < current ? "bg-primary text-white" : i === current ? "bg-primary/20 text-primary border-2 border-primary" : "bg-gray-100 text-gray-400"
            }`}>
              {i < current ? "✓" : i + 1}
            </div>
            <span className={`text-xs hidden sm:inline ${i <= current ? "text-text font-medium" : "text-gray-400"}`}>
              {["Get Started", "Your Profile", "Rate & Availability"][i]}
            </span>
          </div>
        ))}
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-100">
        <div className="h-1.5 rounded-full bg-primary transition-all duration-500" style={{ width: `${((current) / total) * 100}%` }} />
      </div>
    </div>
  );
}

// ─── Main Component ───
interface Props {
  onComplete: (data: CandidateData) => void;
  initialStage?: number;
  existingCandidate?: CandidateData | null;
}

export default function ApplicationForm({ onComplete, initialStage = 0, existingCandidate }: Props) {
  const [stage, setStage] = useState(initialStage >= 1 && initialStage < 3 ? initialStage : 0);
  const [candidateId, setCandidateId] = useState(existingCandidate?.id || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Stage 1 fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("");
  const [roleCategory, setRoleCategory] = useState("");

  // Stage 2 fields
  const [tagline, setTagline] = useState(existingCandidate?.tagline || "");
  const [yearsExperience, setYearsExperience] = useState(existingCandidate?.years_experience || "");
  const [bio, setBio] = useState(existingCandidate?.bio || "");
  const [tools, setTools] = useState<string[]>(existingCandidate?.tools || []);
  const [usExperience, setUsExperience] = useState(existingCandidate?.us_client_experience || "");
  const [usDescription, setUsDescription] = useState(existingCandidate?.us_client_description || "");
  const [linkedinUrl, setLinkedinUrl] = useState(existingCandidate?.linkedin_url || "");

  // Stage 3 fields
  const [hourlyRate, setHourlyRate] = useState(existingCandidate?.hourly_rate || 0);
  const [availability, setAvailability] = useState(existingCandidate?.availability_status || "available_now");
  const [timeZone, setTimeZone] = useState("");
  const [startDate, setStartDate] = useState("");

  // Pre-fill from auth
  useEffect(() => {
    async function prefill() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setEmail(user.email || "");
        const fullName = user.user_metadata?.full_name || "";
        const parts = fullName.split(" ");
        setFirstName(parts[0] || "");
        setLastName(parts.slice(1).join(" ") || "");
      }
      try { setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { setTimeZone("UTC"); }
    }
    prefill();
  }, []);

  // Pre-fill from existing candidate (return flow)
  useEffect(() => {
    if (existingCandidate) {
      setCandidateId(existingCandidate.id);
      if (existingCandidate.first_name) {
        setFirstName(existingCandidate.first_name);
        setLastName(existingCandidate.last_name || "");
      } else {
        const parts = (existingCandidate.full_name || "").split(" ");
        setFirstName(parts[0] || "");
        setLastName(parts.slice(1).join(" ") || "");
      }
      setEmail(existingCandidate.email || "");
      setCountry(existingCandidate.country || "");
      setRoleCategory(existingCandidate.role_category || "");
      setTagline(existingCandidate.tagline || "");
      setYearsExperience(existingCandidate.years_experience || "");
      setBio(existingCandidate.bio || "");
      setTools(existingCandidate.tools || []);
      setUsExperience(existingCandidate.us_client_experience || "");
      setUsDescription(existingCandidate.us_client_description || "");
      setLinkedinUrl(existingCandidate.linkedin_url || "");
      setHourlyRate(existingCandidate.hourly_rate || 0);
      setAvailability(existingCandidate.availability_status || "available_now");
      setTimeZone(existingCandidate.time_zone || "UTC");
    }
  }, [existingCandidate]);

  const showUsDescription = usExperience === "full_time" || usExperience === "part_time_contract";

  // ═══ STAGE 1 SUBMIT ═══
  async function handleStage1(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!firstName.trim() || !lastName.trim()) { setError("Please enter your full name"); return; }
    if (!country) { setError("Please select your country"); return; }
    if (!roleCategory) { setError("Please select your primary role"); return; }

    setLoading(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not authenticated"); setLoading(false); return; }

    const fullName = `${firstName.trim()} ${lastName.trim()}`;

    // Ensure profile exists
    await fetch("/api/ensure-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, email: user.email, role: "candidate", fullName }),
    });

    // Check for existing candidate
    const { data: existing } = await supabase.from("candidates").select("id").eq("user_id", user.id).maybeSingle();

    const displayName = lastName.trim()
      ? `${firstName.trim()} ${lastName.trim()[0]}.`
      : firstName.trim();

    if (existing) {
      // Already exists — update and advance
      await supabase.from("candidates").update({
        full_name: fullName,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        display_name: displayName,
        country,
        role_category: roleCategory,
        application_stage: 1,
        stage1_completed_at: new Date().toISOString(),
      }).eq("id", existing.id);
      setCandidateId(existing.id);
    } else {
      // Create candidate record immediately
      const { data: newCandidate, error: insertErr } = await supabase.from("candidates").insert({
        user_id: user.id,
        full_name: fullName,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        display_name: displayName,
        email: user.email || email,
        country,
        role_category: roleCategory,
        years_experience: "0-1",
        hourly_rate: 5,
        time_zone: timeZone || "UTC",
        us_client_experience: "none",
        application_stage: 1,
        stage1_completed_at: new Date().toISOString(),
      }).select("id").single();

      if (insertErr) {
        setError("Failed to create your account: " + insertErr.message);
        setLoading(false);
        return;
      }

      setCandidateId(newCandidate.id);

      // Send confirmation email (fire and forget)
      fetch("/api/candidate-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: newCandidate.id, emailType: "application_received" }),
      }).catch(() => {});

      // Queue AI screening
      supabase.from("screening_queue").insert({
        candidate_id: newCandidate.id,
        status: "pending",
      }).then(() => {});
    }

    setStage(1);
    setLoading(false);
  }

  // ═══ STAGE 2 SUBMIT ═══
  async function handleStage2(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!tagline.trim()) { setError("Please add a professional tagline"); return; }
    if (!yearsExperience) { setError("Please select your years of experience"); return; }
    if (!bio.trim()) { setError("Please write a short bio"); return; }
    if (!usExperience) { setError("Please select your US client experience"); return; }

    setLoading(true);

    const supabase = createClient();
    const { error: updateErr } = await supabase.from("candidates").update({
      tagline: tagline.trim(),
      years_experience: yearsExperience,
      bio: bio.trim(),
      tools,
      us_client_experience: usExperience,
      us_client_description: showUsDescription ? usDescription.trim() : null,
      linkedin_url: linkedinUrl.trim() || null,
      application_stage: 2,
      stage2_completed_at: new Date().toISOString(),
    }).eq("id", candidateId);

    if (updateErr) {
      setError("Failed to save: " + updateErr.message);
      setLoading(false);
      return;
    }

    setStage(2);
    setLoading(false);
  }

  // ═══ STAGE 3 SUBMIT ═══
  async function handleStage3(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (hourlyRate < 3) { setError("Hourly rate must be at least $3/hr"); return; }

    setLoading(true);

    const supabase = createClient();
    const { error: updateErr } = await supabase.from("candidates").update({
      hourly_rate: hourlyRate,
      availability_status: availability,
      time_zone: timeZone,
      application_stage: 3,
    }).eq("id", candidateId);

    if (updateErr) {
      setError("Failed to save: " + updateErr.message);
      setLoading(false);
      return;
    }

    // Fetch full candidate data and complete
    const { data: candidateData } = await supabase.from("candidates").select("*").eq("id", candidateId).single();

    if (candidateData) {
      onComplete(candidateData as CandidateData);
    }

    setLoading(false);
  }

  // ═══ STAGE 1: GET STARTED ═══
  if (stage === 0) {
    return (
      <div className="mx-auto max-w-xl px-6 py-8">
        <ProgressBar current={0} total={3} />
        <h1 className="text-2xl font-bold text-text">Get Started</h1>
        <p className="mt-1 text-sm text-text/60">Tell us who you are. This takes under a minute.</p>

        <form onSubmit={handleStage1} className="mt-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text">First Name <span className="text-red-500">*</span></label>
              <input required maxLength={50} value={firstName} onChange={(e) => setFirstName(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary" placeholder="e.g. Maria" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text">Last Name <span className="text-red-500">*</span></label>
              <input required maxLength={50} value={lastName} onChange={(e) => setLastName(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary" placeholder="e.g. Santos" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text">Email</label>
            <input type="email" value={email} disabled className="mt-1 block w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-text/60" />
          </div>

          <div>
            <label className="block text-sm font-medium text-text">Country of Residence <span className="text-red-500">*</span></label>
            <select required value={country} onChange={(e) => setCountry(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary">
              <option value="">Select country</option>
              {COUNTRY_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.countries.map((c) => <option key={c} value={c}>{c}</option>)}
                </optgroup>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text">Primary Role <span className="text-red-500">*</span></label>
            <SearchableRoleSelect value={roleCategory} onChange={setRoleCategory} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={loading} className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50">
            {loading ? "Creating your account..." : "Continue"}
          </button>
        </form>
      </div>
    );
  }

  // ═══ STAGE 2: PROFESSIONAL PROFILE ═══
  if (stage === 1) {
    return (
      <div className="mx-auto max-w-xl px-6 py-8">
        <ProgressBar current={1} total={3} />
        <h1 className="text-2xl font-bold text-text">Your Professional Profile</h1>
        <p className="mt-1 text-sm text-text/60">Help clients understand your expertise. This takes about 3 minutes.</p>

        <form onSubmit={handleStage2} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text">Professional Tagline <span className="text-red-500">*</span></label>
            <input required maxLength={120} value={tagline} onChange={(e) => setTagline(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary" placeholder="e.g. Senior Paralegal with 8 years of litigation experience" />
            <p className="mt-1 text-xs text-gray-400">{tagline.length}/120</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text">Years of Experience <span className="text-red-500">*</span></label>
            <select required value={yearsExperience} onChange={(e) => setYearsExperience(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary">
              <option value="">Select</option>
              {EXPERIENCE_OPTIONS.map((o) => <option key={o} value={o}>{o} years</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text">Short Bio <span className="text-red-500">*</span></label>
            <textarea required maxLength={400} rows={4} value={bio} onChange={(e) => setBio(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary" placeholder="Describe your background, key strengths, and what you bring to a client." />
            <p className="mt-1 text-xs text-gray-400">{bio.length}/400</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text mb-1">Tools & Software You Use</label>
            <TagInput tags={tools} setTags={setTools} max={8} placeholder="Type and press Enter" suggestions={TOOLS_SUGGESTIONS} />
          </div>

          <div>
            <label className="block text-sm font-medium text-text mb-2">US Client Experience <span className="text-red-500">*</span></label>
            <div className="space-y-2">
              {US_EXPERIENCE_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 cursor-pointer hover:border-primary/30 transition-colors">
                  <input type="radio" name="usExp" value={opt.value} checked={usExperience === opt.value} onChange={(e) => setUsExperience(e.target.value)} className="text-primary focus:ring-primary" />
                  <span className="text-sm text-text">{opt.label}</span>
                </label>
              ))}
            </div>
            {showUsDescription && (
              <textarea maxLength={200} rows={2} value={usDescription} onChange={(e) => setUsDescription(e.target.value)} className="mt-3 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary" placeholder="Briefly describe your US client work..." />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-text">LinkedIn URL <span className="text-text/40">(optional)</span></label>
            <input type="url" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary" placeholder="https://linkedin.com/in/yourprofile" />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={loading} className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50">
            {loading ? "Saving..." : "Continue"}
          </button>
        </form>
      </div>
    );
  }

  // ═══ STAGE 3: RATE & AVAILABILITY ═══
  if (stage === 2) {
    return (
      <div className="mx-auto max-w-xl px-6 py-8">
        <ProgressBar current={2} total={3} />
        <h1 className="text-2xl font-bold text-text">Rate & Availability</h1>
        <p className="mt-1 text-sm text-text/60">Final step before your identity verification. Under a minute.</p>

        <form onSubmit={handleStage3} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text">Hourly Rate (USD) <span className="text-red-500">*</span></label>
            <input type="number" required min={3} max={500} value={hourlyRate || ""} onChange={(e) => setHourlyRate(parseInt(e.target.value) || 0)} className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary" placeholder="e.g. 15" />
            <p className="mt-1 text-xs text-gray-400">Minimum $3/hr. Clients see this rate on your profile.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text">Weekly Availability</label>
            <select value={availability} onChange={(e) => setAvailability(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary">
              <option value="available_now">Available now — full time</option>
              <option value="partially_available">Partially available — some hours open</option>
              <option value="not_available">Not available yet — future start</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text">Time Zone</label>
            <input type="text" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-text/60" />
          </div>

          <div>
            <label className="block text-sm font-medium text-text">Available Start Date <span className="text-text/40">(optional)</span></label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary" />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={loading} className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50">
            {loading ? "Saving..." : "Complete & Continue to Verification"}
          </button>
        </form>
      </div>
    );
  }

  return null;
}
