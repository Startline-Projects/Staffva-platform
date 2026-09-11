"use client";

import CountrySelect from "@/components/CountrySelect";

import { useState, useEffect, useRef, useCallback } from "react";
import { SKILLS_BY_ROLE } from "@/lib/roleSkills";
import { createClient } from "@/lib/supabase/client";
import type { CandidateData } from "@/app/(apply)/apply/page";

// Countries come from the shared list, not a second one kept here.
//
// This file used to carry its own 44-country COUNTRY_GROUPS, which made the
// application form a SECOND country gate with different contents from signup:
// it had the Gulf states signup was missing, and lacked the United States,
// every European country and most of Africa and Asia. A candidate whose
// country existed at signup could reach this form and find it absent, and the
// only way through was the "Other" option — which is exactly what 11 live
// candidates have stored as their country today.
//
// One list, one answer. See src/lib/atlasCountries.ts.

// ─── Role Categories ───
const ROLE_CATEGORIES = [
  { group: "Legal", roles: ["Paralegal", "Legal Assistant", "Legal Secretary", "Litigation Support", "Contract Reviewer"] },
  { group: "Accounting & Finance", roles: ["Bookkeeper", "Accounts Payable Specialist", "Accounts Receivable Specialist", "Payroll Specialist", "Tax Preparer", "Financial Analyst"] },
  { group: "Administrative", roles: ["Administrative Assistant", "Executive Assistant", "Virtual Assistant", "Office Manager", "Data Entry Specialist", "Transcriptionist"] },
  { group: "Sales & Outreach", roles: ["Cold Caller", "Sales Representative", "Sales Development Representative (SDR)", "Appointment Setter", "Account Manager", "Lead Generation Specialist"] },
  { group: "Marketing & SEO", roles: ["Social Media Manager", "Content Writer", "SEO Specialist", "Paid Ads Specialist", "Email Marketing Specialist", "CRM Manager"] },
  { group: "Scheduling & Support", roles: ["Scheduling Coordinator", "Customer Support Representative"] },
  { group: "Medical", roles: ["Medical Billing Specialist", "Medical Administrative Assistant", "Insurance Verification Specialist", "Dental Office Administrator"] },
  { group: "Real Estate", roles: ["Real Estate Assistant", "Transaction Coordinator"] },
  { group: "HR & Recruitment", roles: ["HR Assistant", "Recruitment Coordinator"] },
  { group: "Creative & Design", roles: ["Graphic Designer", "Video Editor"] },
  { group: "Operations & E-commerce", roles: ["Project Manager", "Operations Assistant", "E-Commerce Manager", "Shopify Manager", "Amazon Store Manager"] },
  { group: "Tech", roles: ["Software Developer", "Web Developer", "Mobile Developer", "UI/UX Designer", "DevOps Engineer", "Data Analyst", "QA Engineer", "IT Support", "Software Engineer", "Full Stack Developer", "Frontend Developer", "Backend Developer", "LLM Engineer", "AI Engineer"] },
  { group: "Other", roles: ["Other"] },
];

// SKILLS_BY_ROLE moved to @/lib/roleSkills — one copy, shared with the server.

const TOOLS_BY_ROLE: Record<string, string[]> = {
  // ── Legal ──
  "Paralegal": ["Clio", "MyCase", "PracticePanther", "LexisNexis", "Westlaw", "Microsoft Word", "Adobe Acrobat", "Outlook", "Dropbox", "Zoom"],
  "Legal Assistant": ["Clio", "MyCase", "PracticePanther", "LexisNexis", "Westlaw", "Microsoft Word", "Adobe Acrobat", "Outlook", "Dropbox", "Zoom"],
  "Legal Secretary": ["Clio", "MyCase", "Microsoft Word", "Outlook", "Adobe Acrobat", "LexisNexis", "Dropbox", "DocuSign", "Zoom", "Google Workspace"],
  "Litigation Support": ["Relativity", "Clio", "Westlaw", "LexisNexis", "CaseMap", "Adobe Acrobat", "Microsoft Word", "Dropbox", "Zoom", "Outlook"],
  "Contract Reviewer": ["DocuSign", "Adobe Acrobat", "Microsoft Word", "LexisNexis", "Westlaw", "Ironclad", "ContractPodAi", "Google Drive", "Outlook", "Notion"],
  // ── Accounting & Finance ──
  "Bookkeeper": ["QuickBooks", "Xero", "FreshBooks", "Bill.com", "Excel", "Gusto", "Stripe", "Expensify", "Sage", "Google Sheets"],
  "Accounts Payable Specialist": ["QuickBooks", "Bill.com", "NetSuite", "SAP", "Concur", "Excel", "Tipalti", "Outlook", "Sage", "Expensify"],
  "Accounts Receivable Specialist": ["QuickBooks", "Xero", "NetSuite", "Stripe", "FreshBooks", "Excel", "Bill.com", "Outlook", "Google Sheets", "Sage"],
  "Payroll Specialist": ["Gusto", "ADP", "Paychex", "Rippling", "QuickBooks Payroll", "Excel", "BambooHR", "Workday", "Outlook", "Google Sheets"],
  "Tax Preparer": ["TurboTax Business", "ProConnect", "Drake Tax", "Lacerte", "TaxSlayer Pro", "QuickBooks", "Excel", "Adobe Acrobat", "IRS e-Services", "Google Sheets"],
  "Financial Analyst": ["Excel", "Google Sheets", "QuickBooks", "NetSuite", "Xero", "Tableau", "Power BI", "Bloomberg", "Looker Studio", "Notion"],
  // ── Administrative ──
  "Administrative Assistant": ["Google Workspace", "Microsoft 365", "Zoom", "Slack", "Asana", "Trello", "Calendly", "HubSpot", "Notion", "Dropbox"],
  "Executive Assistant": ["Google Workspace", "Microsoft 365", "Zoom", "Calendly", "Notion", "Slack", "Asana", "Expensify", "Trello", "Dropbox"],
  "Virtual Assistant": ["Google Workspace", "Microsoft 365", "Asana", "Trello", "Notion", "Slack", "Zoom", "Calendly", "HubSpot", "Airtable"],
  "Office Manager": ["Google Workspace", "Microsoft 365", "QuickBooks", "Slack", "Zoom", "Asana", "Gusto", "Expensify", "Notion", "Trello"],
  "Data Entry Specialist": ["Microsoft Excel", "Google Sheets", "Airtable", "Salesforce", "HubSpot", "Zoho CRM", "Notion", "Microsoft Access", "Smartsheet", "Google Forms"],
  "Transcriptionist": ["Otter.ai", "Rev", "Microsoft Word", "Express Scribe", "oTranscribe", "Google Docs", "Descript", "Trint", "Zoom", "Adobe Audition"],
  // ── Sales & Outreach ──
  "Cold Caller": ["HubSpot", "Salesforce", "Pipedrive", "Dialpad", "RingCentral", "Outreach", "Apollo.io", "Close", "Zoom", "Slack"],
  "Sales Representative": ["HubSpot", "Salesforce", "Pipedrive", "Zoom", "Outreach", "Apollo.io", "LinkedIn Sales Navigator", "Slack", "Close", "Google Workspace"],
  "Sales Development Representative (SDR)": ["Outreach", "Salesloft", "HubSpot", "Salesforce", "Apollo.io", "LinkedIn Sales Navigator", "ZoomInfo", "Slack", "Close", "Zoom"],
  "Appointment Setter": ["HubSpot", "Salesforce", "Calendly", "Pipedrive", "Dialpad", "RingCentral", "Close", "Outreach", "Zoom", "Slack"],
  "Account Manager": ["HubSpot", "Salesforce", "Pipedrive", "Zoom", "Slack", "Notion", "Asana", "Microsoft 365", "Google Workspace", "Gainsight"],
  "Lead Generation Specialist": ["Apollo.io", "ZoomInfo", "LinkedIn Sales Navigator", "HubSpot", "Salesforce", "Hunter.io", "Lusha", "Instantly", "Lemlist", "Google Sheets"],
  // ── Marketing & SEO ──
  "Social Media Manager": ["Hootsuite", "Buffer", "Sprout Social", "Canva", "Later", "Meta Business Suite", "TikTok Ads Manager", "Google Analytics", "Notion", "Slack"],
  "Content Writer": ["Google Docs", "WordPress", "Notion", "Grammarly", "Surfer SEO", "SEMrush", "Ahrefs", "Canva", "Hemingway Editor", "HubSpot"],
  "SEO Specialist": ["Ahrefs", "SEMrush", "Google Search Console", "Moz", "Surfer SEO", "Screaming Frog", "Google Analytics", "WordPress", "Looker Studio", "Yoast"],
  "Paid Ads Specialist": ["Google Ads", "Meta Ads Manager", "LinkedIn Ads", "TikTok Ads Manager", "Google Analytics", "Looker Studio", "Canva", "ClickUp", "Hotjar", "Slack"],
  "Email Marketing Specialist": ["Mailchimp", "Klaviyo", "ActiveCampaign", "HubSpot", "Constant Contact", "ConvertKit", "Zapier", "Google Analytics", "Canva", "Beehiiv"],
  "CRM Manager": ["HubSpot", "Salesforce", "Pipedrive", "Zoho CRM", "ActiveCampaign", "Zapier", "Airtable", "Slack", "Monday.com", "Google Sheets"],
  // ── Scheduling & Support ──
  "Scheduling Coordinator": ["Calendly", "Acuity", "Google Calendar", "Outlook", "Mindbody", "Jane App", "Zoom", "Slack", "OpenDental", "Dentrix"],
  "Customer Support Representative": ["Zendesk", "Intercom", "Freshdesk", "Gorgias", "HubSpot", "Salesforce", "Slack", "LiveChat", "Front", "Zoom"],
  // ── Medical ──
  "Medical Billing Specialist": ["Kareo", "AdvancedMD", "eClinicalWorks", "Athenahealth", "DrChrono", "Excel", "Change Healthcare", "Availity", "Waystar", "Outlook"],
  "Medical Administrative Assistant": ["Epic", "Cerner", "Athenahealth", "Kareo", "DrChrono", "Microsoft 365", "Zoom", "Outlook", "Google Workspace", "AdvancedMD"],
  "Insurance Verification Specialist": ["Availity", "Kareo", "Epic", "eClinicalWorks", "Athenahealth", "Excel", "Change Healthcare", "Outlook", "Waystar", "Cerner"],
  "Dental Office Administrator": ["Dentrix", "Eaglesoft", "OpenDental", "Carestream", "Dolphin", "Microsoft 365", "Zoom", "Outlook", "Google Workspace", "Dentimax"],
  // ── Real Estate ──
  "Real Estate Assistant": ["Follow Up Boss", "Chime", "DocuSign", "Dotloop", "MLS", "Google Workspace", "Trello", "Canva", "Zoom", "Slack"],
  "Transaction Coordinator": ["Dotloop", "DocuSign", "SkySlope", "Zipforms", "MLS", "Google Workspace", "Trello", "Outlook", "Notary Cam", "Slack"],
  // ── HR & Recruitment ──
  "HR Assistant": ["BambooHR", "Gusto", "ADP", "Rippling", "Workday", "Google Workspace", "Zoom", "Slack", "Notion", "Microsoft 365"],
  "Recruitment Coordinator": ["LinkedIn Recruiter", "Greenhouse", "Lever", "Workable", "Indeed", "BambooHR", "Zoom", "Google Workspace", "Slack", "Calendly"],
  // ── Creative & Design ──
  "Graphic Designer": ["Adobe Photoshop", "Adobe Illustrator", "Canva", "Figma", "Adobe InDesign", "Adobe After Effects", "Procreate", "Slack", "Google Drive", "Notion"],
  "Video Editor": ["Adobe Premiere Pro", "DaVinci Resolve", "Final Cut Pro", "Adobe After Effects", "CapCut", "Canva", "Frame.io", "Slack", "Google Drive", "Descript"],
  // ── Operations & E-Commerce ──
  "Project Manager": ["Asana", "Monday.com", "Jira", "Trello", "Notion", "Slack", "Zoom", "ClickUp", "Google Workspace", "Confluence"],
  "Operations Assistant": ["Asana", "Monday.com", "Google Workspace", "Slack", "Notion", "Airtable", "Trello", "Zoom", "ClickUp", "Smartsheet"],
  "E-Commerce Manager": ["Shopify", "WooCommerce", "Amazon Seller Central", "Google Analytics", "Meta Ads Manager", "Klaviyo", "Canva", "Airtable", "Slack", "Looker Studio"],
  "Shopify Manager": ["Shopify", "Google Analytics", "Klaviyo", "Canva", "Meta Ads Manager", "Airtable", "Slack", "Loox", "Yotpo", "Gorgias"],
  "Amazon Store Manager": ["Amazon Seller Central", "Helium 10", "Jungle Scout", "Google Sheets", "Airtable", "Canva", "Asana", "Slack", "DataDive", "Keepa"],
};

const EXPERIENCE_OPTIONS = ["0-1", "1-3", "3-5", "5-10", "10+"];

const US_EXPERIENCE_DURATION_OPTIONS = [
  { value: "less_than_6_months", label: "Less than 6 months" },
  { value: "6_months_to_1_year", label: "6 months to 1 year" },
  { value: "1_to_2_years", label: "1 to 2 years" },
  { value: "2_to_5_years", label: "2 to 5 years" },
  { value: "5_plus_years", label: "5+ years" },
];

const US_EXPERIENCE_NO_OPTIONS = [
  { value: "international_only", label: "I've worked with international clients (non-US)" },
  { value: "none", label: "This would be my first international client" },
];

const US_EXPERIENCE_DURATION_VALUES = US_EXPERIENCE_DURATION_OPTIONS.map((o) => o.value);
const US_EXPERIENCE_NO_VALUES = US_EXPERIENCE_NO_OPTIONS.map((o) => o.value);

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

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
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
    <div ref={containerRef} className={`country-wrap ${open ? "open" : ""}`}>
      {/* Trigger button — the Atlas picker trigger; the chevron is ::after and
          rotates from .country-wrap.open, so there is no inline icon here. */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`country-trigger ${value ? "" : "empty"}`}
      >
        <span className="country-name">{value || "Select your role"}</span>
      </button>

      {/* Backdrop for mobile — sits UNDER the menu (z-30) now that the menu is
          the Atlas anchored dropdown rather than a z-50 bottom sheet. */}
      {open && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Dropdown */}
      {open && (
        <div className="country-menu" onKeyDown={handleKeyDown}>
          {/* Search input — pinned */}
          <div className="country-search-wrap">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search roles..."
              className="country-search"
            />
          </div>

          {/* Role list — only scrollable element. One child element per
              filtered item: the highlight effect indexes listRef children. */}
          <div ref={listRef} className="country-list">
            {filtered.length === 0 ? (
              <div className="country-empty">No roles found — try a different search.</div>
            ) : (
              (() => {
                let currentGroup = "";
                return filtered.map((item, i) => {
                  const showGroup = item.group !== currentGroup;
                  currentGroup = item.group;
                  return (
                    <div key={`${item.group}-${item.role}`}>
                      {showGroup && (
                        <p className="eyebrow px-3 pt-3 pb-1">{item.group}</p>
                      )}
                      <button
                        type="button"
                        onClick={() => { onChange(item.role); setOpen(false); setSearch(""); }}
                        className={`country-option w-full ${
                          i === highlightIndex ? "focused" : value === item.role ? "selected" : ""
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
      <div className="cat-chips mb-2">
        {tags.map((tag) => (
          <span key={tag} className="cat-chip selected">
            {tag}
            <button type="button" onClick={() => setTags(tags.filter((t) => t !== tag))} className="ml-2 opacity-60 hover:opacity-100">×</button>
          </span>
        ))}
      </div>
      {/* On a phone the keyboard shows "next", not "return", because this input
          sits in a form with more fields below — and "next" moves focus without
          ever firing a keydown for Enter. (Android GBoard advances focus
          directly; mid-composition, keydown reports keyCode 229 rather than
          Enter.) So the typed word was silently dropped and the form jumped on.
          Three defences: a visible Add button, enterKeyHint so the key says
          "done" instead of "next", and adding whatever is pending on blur so it
          survives however focus leaves. addTag dedupes, so blur-then-tap on Add
          cannot double-add. */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          enterKeyHint="done"
          onChange={(e) => setInput(e.target.value)}
          onBlur={() => addTag(input)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(input); } if (e.key === "Backspace" && !input && tags.length) setTags(tags.slice(0, -1)); }}
          placeholder={tags.length >= max ? `Max ${max} reached` : placeholder}
          disabled={tags.length >= max}
          className="input"
        />
        <button
          type="button"
          onClick={() => addTag(input)}
          disabled={!input.trim() || tags.length >= max}
          className="state-action-btn shrink-0 disabled:opacity-30"
        >
          Add
        </button>
      </div>
      {suggestions && suggestions.length > 0 && tags.length < max && (
        <div className="cat-chips mt-2">
          {suggestions.filter((s) => !tags.includes(s)).slice(0, 6).map((s) => (
            <button key={s} type="button" onClick={() => addTag(s)} className="cat-chip">
              + {s}
            </button>
          ))}
        </div>
      )}
      <p className={`cat-chip-count ${tags.length > 0 ? "has-selection" : ""}`}>{tags.length}/{max}</p>
    </div>
  );
}

// ─── Progress Bar ───
// The numbered circles and the coloured rail were the legacy indicator. Atlas
// says the same thing in the mono pipeline line the rest of the flow already
// uses (verify-id, verify-phone, assessment): the step you are on and the ones
// behind you in ink, the ones ahead muted, dots between.
const STAGE_LABELS = ["Get Started", "Your Profile", "Rate & Availability"];

function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <span className="pipeline-step-indicator flex-wrap justify-center">
      <span className="step-num">Step {current + 1} of {total}</span>
      {STAGE_LABELS.flatMap((label, i) => [
        <span key={`sep-${i}`} className="pipe-sep" aria-hidden />,
        <span key={label} className={i <= current ? "step-num" : undefined}>{label}</span>,
      ])}
    </span>
  );
}

// ─── Main Component ───
interface Props {
  onComplete: (data: CandidateData) => void;
  initialStage?: number;
  existingCandidate?: CandidateData | null;
}


/* The two icons the Atlas form idiom expects, matching src/app/signup/candidate
   verbatim: .form-alert leads with a warning glyph, and .btn-submit carries an
   .arrow that the stylesheet slides on hover. */
const ALERT_ICON = (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
    <circle cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M9 5.25v4.5M9 12.375v.375" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const SUBMIT_ARROW = (
  <svg className="arrow" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
    <path d="M3.75 9h10.5M9.75 4.5 14.25 9l-4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

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
  const [customRoleDescription, setCustomRoleDescription] = useState("");

  // Stage 2 fields
  const [yearsExperience, setYearsExperience] = useState(existingCandidate?.years_experience || "");
  const [bio, setBio] = useState(existingCandidate?.bio || "");
  const [skills, setSkills] = useState<string[]>(existingCandidate?.skills || []);
  const [tools, setTools] = useState<string[]>(existingCandidate?.tools || []);
  const [usExperience, setUsExperience] = useState(existingCandidate?.us_client_experience || "");
  const [linkedinUrl, setLinkedinUrl] = useState(existingCandidate?.linkedin_url || "");

  // Stage 3 fields
  const [hourlyRate, setHourlyRate] = useState(existingCandidate?.hourly_rate || 0);
  const [timeZone, setTimeZone] = useState("");

  // Pre-fill from auth
  useEffect(() => {
    async function prefill() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setEmail(user.email || "");
        const meta = user.user_metadata || {};
        const fullName = meta.full_name || "";
        const parts = fullName.split(" ");
        setFirstName(parts[0] || "");
        setLastName(parts.slice(1).join(" ") || "");
        // Signup already asked for these and stored them on the auth user (the
        // handle_new_user trigger copies the same two onto profiles as
        // signup_country / signup_role_category). Asking again was pure
        // re-entry: the candidate picked their country on the signup screen and
        // was handed an empty country picker one screen later.
        //
        // Prefilled, not locked — someone who mistyped at signup, or moved,
        // can still change it, and whatever is in the field at submit is what
        // gets written.
        if (meta.signup_country) setCountry(meta.signup_country);
        if (meta.signup_role_category) setRoleCategory(meta.signup_role_category);
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
      // Only overwrite when the saved row actually HAS a value. A returning
      // candidate whose row was created before these were captured has empty
      // strings here, and a blind assignment would wipe the signup prefill
      // above — handing them the empty picker this change exists to remove.
      if (existingCandidate.country) setCountry(existingCandidate.country);
      if (existingCandidate.role_category) setRoleCategory(existingCandidate.role_category);
      setYearsExperience(existingCandidate.years_experience || "");
      setBio(existingCandidate.bio || "");
      setTools(existingCandidate.tools || []);
      setUsExperience(existingCandidate.us_client_experience || "");
      setLinkedinUrl(existingCandidate.linkedin_url || "");
      setHourlyRate(existingCandidate.hourly_rate || 0);
      setTimeZone(existingCandidate.time_zone || "UTC");
    }
  }, [existingCandidate]);

  // Two-step Yes/No flow: derive Yes/No from the chosen value so the UI re-opens correctly on edit.
  const initialYesNo = usExperience
    ? US_EXPERIENCE_DURATION_VALUES.includes(usExperience)
      ? "yes"
      : US_EXPERIENCE_NO_VALUES.includes(usExperience)
      ? "no"
      : ""
    : "";
  const [usExperienceYesNo, setUsExperienceYesNo] = useState<string>(initialYesNo);

  function handleUsYesNoChange(v: string) {
    setUsExperienceYesNo(v);
    // Reset the sub-selection when toggling between yes/no so a stale value can't be submitted.
    if (
      (v === "yes" && !US_EXPERIENCE_DURATION_VALUES.includes(usExperience)) ||
      (v === "no" && !US_EXPERIENCE_NO_VALUES.includes(usExperience))
    ) {
      setUsExperience("");
    }
  }

  // ═══ STAGE 1 SUBMIT ═══
  async function handleStage1(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!firstName.trim() || !lastName.trim()) { setError("Please enter your full name"); return; }
    if (!country) { setError("Please select your country"); return; }
    if (!roleCategory) { setError("Please select your primary role"); return; }
    if (roleCategory === "Other" && !customRoleDescription.trim()) { setError("Please describe your role"); return; }

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

    const effectiveRole = roleCategory === "Other" ? customRoleDescription.trim() : roleCategory;

    if (existing) {
      // Already exists — update and advance
      await supabase.from("candidates").update({
        full_name: fullName,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        display_name: displayName,
        country,
        role_category: effectiveRole,
        custom_role_description: roleCategory === "Other" ? customRoleDescription.trim() : null,
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
        role_category: effectiveRole,
        custom_role_description: roleCategory === "Other" ? customRoleDescription.trim() : null,
        years_experience: "0-1",
        hourly_rate: 5,
        time_zone: timeZone || "UTC",
        us_client_experience: null,
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

      // AI screening is deliberately NOT queued here. At this point the record
      // holds placeholders the form invented — years_experience "0-1",
      // hourly_rate 5, us_client_experience null, and no bio, skills or tools.
      // Screening on that scored 192 of 192 candidates before they had filled
      // anything in, and tagged 85% of them "Hold" at an average 1.02/5. The
      // model was describing an empty record, not a person. Queued at the end
      // of stage 2 instead, once there is something to judge.

      // If custom role, classify via API (fire and forget)
      if (roleCategory === "Other" && customRoleDescription.trim()) {
        fetch("/api/candidate/classify-role", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId: newCandidate.id, customRole: customRoleDescription.trim() }),
        }).catch(() => {});
      }
    }

    setStage(1);
    setLoading(false);
  }

  // ═══ STAGE 2 SUBMIT ═══
  async function handleStage2(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!yearsExperience) { setError("Please select your years of experience"); return; }
    if (!bio.trim()) { setError("Please write a short bio"); return; }
    if (!usExperienceYesNo) { setError("Please answer the US client experience question"); return; }
    if (!usExperience) {
      setError(usExperienceYesNo === "yes" ? "Please select how long you've worked with US clients" : "Please select an option");
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { error: updateErr } = await supabase.from("candidates").update({
      years_experience: yearsExperience,
      bio: bio.trim(),
      skills,
      tools,
      us_client_experience: usExperience,
      linkedin_url: linkedinUrl.trim() || null,
      application_stage: 2,
      stage2_completed_at: new Date().toISOString(),
    }).eq("id", candidateId);

    if (updateErr) {
      setError("Failed to save: " + updateErr.message);
      setLoading(false);
      return;
    }

    // Queue AI screening now, not at stage 1 — this is the first point at which
    // the record contains the candidate's own answers rather than placeholders.
    //
    // Through an RPC rather than an upsert. screening_queue grants candidates
    // INSERT and nothing else, so the previous `upsert(..., {onConflict})` —
    // which Postgres runs as INSERT ... ON CONFLICT DO UPDATE — had its update
    // arm refused by RLS for anyone who already had a row. Every one of the 251
    // existing rows is already 'complete', so the refused arm was the only one
    // that mattered: it silently blocked re-screening for exactly the candidates
    // who came back to correct answers that had been judged on placeholders.
    // request_screening owns that transition and clears the prior run's retry
    // and backoff state. See migration 00102.
    const { error: queueErr } = await supabase.rpc("request_screening", {
      p_candidate_id: candidateId,
    });

    if (queueErr) {
      // Deliberately does not advance. Advancing would leave someone fully
      // applied but never screened and never shown to a recruiter — invisible
      // to them and to us, which is the failure mode this whole path exists to
      // remove. Their answers are already saved above, so retrying costs one
      // click and cannot duplicate anything.
      setError(
        "Your answers are saved, but we couldn't queue your application for review: " +
          queueErr.message +
          ". Please press continue again."
      );
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
      // hourly_rate stays: the AI screening that runs at the end of this form
      // reads it, along with bio. Removing either would have the screening judge
      // a $0 rate and an empty bio — the exact shape of the bug that once tagged
      // 85% of candidates "Hold".
      hourly_rate: hourlyRate,
      // availability_status is NOT written here any more. It is asked in Build
      // Your Profile, where it is required and paired with a date. The column is
      // NOT NULL with a database default of 'available_now', which is what this
      // form defaulted to anyway, so nothing downstream sees a gap.
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
      <div className="page page-narrow">
        <div className="signin-layout" style={{ maxWidth: "560px" }}>
          <header className="signin-header">
            <ProgressBar current={0} total={3} />
            <h1 className="display">Get <span className="serif-italic">Started</span></h1>
            <p className="lead">Tell us who you are. This takes under a minute.</p>
          </header>

          <div className="form-card">
            <form onSubmit={handleStage1}>
              <div className="form-row split">
                <div>
                  <label className="field-label">
                    <span>First Name</span>
                    <span className="req">Required</span>
                  </label>
                  <input required maxLength={50} value={firstName} onChange={(e) => setFirstName(e.target.value)} className="input" placeholder="e.g. Maria" />
                </div>
                <div>
                  <label className="field-label">
                    <span>Last Name</span>
                    <span className="req">Required</span>
                  </label>
                  <input required maxLength={50} value={lastName} onChange={(e) => setLastName(e.target.value)} className="input" placeholder="e.g. Santos" />
                </div>
              </div>

              <div className="form-row">
                <label className="field-label"><span>Email</span></label>
                <input type="email" value={email} disabled className="input" />
              </div>

              <div className="form-row">
                <label className="field-label">
                  <span>Country of Residence</span>
                  <span className="req">Required</span>
                </label>
                {/* Searchable, not a native <select>: the list is 207 long, and
                    scrolling to Saudi Arabia past Afghanistan, Albania, Algeria…
                    is the difference this component removes. Stores the NAME,
                    which is what candidates.country holds and what
                    api/ensure-profile validates against. */}
                <CountrySelect
                  value={country}
                  onChange={setCountry}
                  by="name"
                  id="applyCountryTrigger"
                  placeholder="Select country"
                />
              </div>

              <div className="form-row">
                <label className="field-label">
                  <span>Primary Role</span>
                  <span className="req">Required</span>
                </label>
                <SearchableRoleSelect value={roleCategory} onChange={(v) => { setRoleCategory(v); if (v !== "Other") setCustomRoleDescription(""); }} />
              </div>

              {roleCategory === "Other" && (
                <div className="form-row">
                  <label className="field-label">
                    <span>Describe Your Role</span>
                    <span className="req">Required</span>
                  </label>
                  <input
                    required
                    maxLength={100}
                    value={customRoleDescription}
                    onChange={(e) => setCustomRoleDescription(e.target.value)}
                    className="input"
                    placeholder="e.g. Grant Writer, Podcast Editor"
                  />
                  <p className="field-hint-inline">{customRoleDescription.length}/100</p>
                </div>
              )}

              {error && (
                <div className="form-alert visible" role="alert">
                  {ALERT_ICON}
                  <span>{error}</span>
                </div>
              )}

              <div className="form-submit-row">
                <button type="submit" disabled={loading} className={`btn-submit ${loading ? "loading" : ""}`}>
                  <span className="submit-label">{loading ? "Creating your account..." : "Continue"}</span>
                  {SUBMIT_ARROW}
                  <span className="spinner" aria-hidden />
                </button>
              </div>
            </form>
          </div>
        </div>
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
            <label className="block text-sm font-medium text-text">Years of Experience <span className="text-red-500">*</span></label>
            <select required value={yearsExperience} onChange={(e) => setYearsExperience(e.target.value)} className="input">
              <option value="">Select</option>
              {EXPERIENCE_OPTIONS.map((o) => <option key={o} value={o}>{o} years</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text">Short Bio <span className="text-red-500">*</span></label>
            <textarea required maxLength={400} rows={4} value={bio} onChange={(e) => setBio(e.target.value)} className="input" placeholder="Describe your background, key strengths, and what you bring to a client." />
            <p className="mt-1 text-xs text-gray-400">{bio.length}/400</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text mb-1">Key Skills</label>
            <TagInput tags={skills} setTags={setSkills} max={10} placeholder="Type a skill, then tap Add" suggestions={SKILLS_BY_ROLE[roleCategory] ?? []} />
          </div>

          <div>
            <label className="block text-sm font-medium text-text mb-1">Tools & Software You Use</label>
            <TagInput tags={tools} setTags={setTools} max={8} placeholder="Type a tool, then tap Add" suggestions={TOOLS_BY_ROLE[roleCategory] ?? []} />
          </div>

          <div>
            <label className="block text-sm font-medium text-text mb-2">Do you have US client experience? <span className="text-red-500">*</span></label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ].map((opt) => (
                <label key={opt.value} className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-3 cursor-pointer hover:border-primary/30 transition-colors">
                  <input type="radio" name="usExpYesNo" value={opt.value} checked={usExperienceYesNo === opt.value} onChange={(e) => handleUsYesNoChange(e.target.value)} className="text-primary focus:ring-primary" />
                  <span className="text-sm text-text">{opt.label}</span>
                </label>
              ))}
            </div>
            {usExperienceYesNo === "yes" && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-text/60 mb-1.5">How long have you worked with US clients?</label>
                <select value={usExperience} onChange={(e) => setUsExperience(e.target.value)} className="input">
                  <option value="">Select duration...</option>
                  {US_EXPERIENCE_DURATION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )}
            {usExperienceYesNo === "no" && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-text/60 mb-1.5">Tell us a bit more</label>
                <select value={usExperience} onChange={(e) => setUsExperience(e.target.value)} className="input">
                  <option value="">Select an option...</option>
                  {US_EXPERIENCE_NO_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-text">LinkedIn URL <span className="text-text/40">(optional)</span></label>
            <input type="url" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} className="input" placeholder="https://linkedin.com/in/yourprofile" />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={loading} className={`btn-submit ${loading ? "loading" : ""}`}>
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
            <input type="number" required min={3} max={500} value={hourlyRate || ""} onChange={(e) => setHourlyRate(parseInt(e.target.value) || 0)} className="input" placeholder="e.g. 15" />
            <p className="mt-1 text-xs text-gray-400">Minimum $3/hr. Clients see this rate on your profile.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text">Time Zone</label>
            <input type="text" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-text/60" />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={loading} className={`btn-submit ${loading ? "loading" : ""}`}>
            {loading ? "Saving..." : "Complete & Continue to Verification"}
          </button>
        </form>
      </div>
    );
  }

  return null;
}
