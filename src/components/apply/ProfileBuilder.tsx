"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import ReferenceFields, { useSavedReferences, saveReference, type ReferenceValue } from "@/components/apply/ReferenceFields";
import { SKILLS_BY_ROLE } from "@/lib/roleSkills";
import { createClient } from "@/lib/supabase/client";
import { profileCompleteness } from "@/lib/profileCompleteness";

interface ProfileBuilderProps {
  candidateId: string;
  candidateData: {
    full_name: string;
    display_name?: string;
    role_category: string;
    hourly_rate: number;
    bio?: string;
    tagline?: string;
    english_written_tier?: string;
    skills?: string[];
    tools?: string[];
    /** Previously saved employers. Seeded into the form so a returning
     *  candidate does not get a blank step 4 — and so their stored references,
     *  which hang off each entry's ref_key, stay matched. */
    work_experience?: WorkEntry[] | null;
    /** Used to decide whether an autosaved draft is newer than the last save. */
    profile_completed_at?: string | null;
    // Read by the review step's checklist. All optional: a candidate part-way
    // through has none of them.
    profile_photo_url?: string | null;
    country?: string | null;
    city?: string | null;
    role_title?: string | null;
    resume_url?: string | null;
    video_intro_url?: string | null;
    voice_recording_2_url?: string | null;
    hours_per_week?: number | null;
    working_hours?: string | null;
    education?: unknown;
    certifications?: unknown;
  };
  onComplete: () => void;
}

/**
 * Eight steps, matching the Atlas builder's A-G plus Review.
 *
 * The mapping is deliberate about one thing: the OLD six steps are all still
 * here, in the same order, doing the same work. Atlas's structure is layered
 * over them rather than replacing them, because every approval gate in the
 * product enumerates resume_url, payout_method and interview_consent_at, and
 * a step set that stopped collecting one of those would silently stop making
 * candidates promotable.
 *
 *   1 (A)  Photo, name, location, title, headline
 *   2 (B)  About you
 *   3 (D)  Skills and tools          <- skills are now WRITTEN, see below
 *   4 (E)  Work history + references
 *   5 (F)  Portfolio and resume
 *   6 (C)  Rate, availability and payout
 *   7 (G)  Education and certifications   <- new, optional
 *   8 (R)  Review and submit              <- new
 */
type BuilderStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const LAST_STEP: BuilderStep = 8;


/** A fresh employer identity. */
function newEmployerKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `emp-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/**
 * The stable identity of one employer entry, which references hang off.
 *
 * This used to be DERIVED from company_name + start_date + role_title, and that
 * was wrong in a way that quietly destroyed data. The key was recomputed on
 * every render, so changing one character of the company name produced a new
 * key, `savedReferences[key]` became undefined, and the fully controlled
 * reference block blanked — name, email, consent, all of it — with no message.
 * The typed contact was then stranded under the old key and never submitted,
 * while the card said "We store this contact."
 *
 * It is also stored in work_experience, which is safe now and would not have
 * been a week ago: contactMask.ts emits an explicit allowlist, and ref_key is
 * not on it, so this never reaches the public profile endpoint.
 */
function employerKeyFor(entry: WorkEntry): string {
  return entry.ref_key || "";
}

interface WorkEntry {
  /** Stable identity for this entry, generated once when it is created.
   *  References hang off this. See employerKeyFor. */
  ref_key?: string;
  company_name: string;
  role_title: string;
  industry: string;
  industry_other?: string;
  duration: string;
  description: string;
  start_date: string;
  end_date: string;
  tools_used: string[];
  skills_gained: string[];
}

interface EducationEntry {
  school: string;
  qualification: string;
  field: string;
  year: string;
}

interface PortfolioItem {
  file: File | null;
  description: string;
}

const TOOLS_BY_ROLE: Record<string, string[]> = {
  Paralegal: [
    "Clio", "MyCase", "PracticePanther", "LexisNexis", "Westlaw",
    "Microsoft Word", "Adobe Acrobat", "Outlook", "Dropbox", "Zoom",
  ],
  "Legal Assistant": [
    "Clio", "MyCase", "PracticePanther", "LexisNexis", "Westlaw",
    "Microsoft Word", "Adobe Acrobat", "Outlook", "Dropbox", "Zoom",
  ],
  "Bookkeeping/AP": [
    "QuickBooks", "Xero", "FreshBooks", "Bill.com", "Gusto",
    "Excel", "NetSuite", "Sage", "Expensify", "Stripe",
  ],
  Admin: [
    "Google Workspace", "Microsoft 365", "Asana", "Trello", "Notion",
    "Slack", "Zoom", "Calendly", "HubSpot", "Salesforce",
  ],
  VA: [
    "Google Workspace", "Microsoft 365", "Asana", "Trello", "Notion",
    "Slack", "Zoom", "Calendly", "HubSpot", "Salesforce",
  ],
  Scheduling: [
    "Calendly", "Acuity", "Google Calendar", "Outlook", "Mindbody",
    "Jane App", "OpenDental", "Dentrix",
  ],
  "Customer Support": [
    "Zendesk", "Intercom", "Freshdesk", "Gorgias", "HubSpot",
    "Salesforce", "Slack", "LiveChat",
  ],
  // ── Legal ──
  "Legal Secretary": [
    "Clio", "MyCase", "Microsoft Word", "Outlook", "Adobe Acrobat",
    "LexisNexis", "Dropbox", "DocuSign", "Zoom", "Google Workspace",
  ],
  "Litigation Support": [
    "Relativity", "Clio", "Westlaw", "LexisNexis", "CaseMap",
    "Adobe Acrobat", "Microsoft Word", "Dropbox", "Zoom", "Outlook",
  ],
  "Contract Reviewer": [
    "DocuSign", "Adobe Acrobat", "Microsoft Word", "LexisNexis",
    "Westlaw", "Ironclad", "ContractPodAi", "Google Drive", "Outlook", "Notion",
  ],
  // ── Accounting & Finance ──
  "Bookkeeper": [
    "QuickBooks", "Xero", "FreshBooks", "Bill.com", "Excel",
    "Gusto", "Stripe", "Expensify", "Sage", "Google Sheets",
  ],
  "Accounts Payable Specialist": [
    "QuickBooks", "Bill.com", "NetSuite", "SAP", "Concur",
    "Excel", "Tipalti", "Outlook", "Sage", "Expensify",
  ],
  "Accounts Receivable Specialist": [
    "QuickBooks", "Xero", "NetSuite", "Stripe", "FreshBooks",
    "Excel", "Bill.com", "Outlook", "Google Sheets", "Sage",
  ],
  "Payroll Specialist": [
    "Gusto", "ADP", "Paychex", "Rippling", "QuickBooks Payroll",
    "Excel", "BambooHR", "Workday", "Outlook", "Google Sheets",
  ],
  "Tax Preparer": [
    "TurboTax Business", "ProConnect", "Drake Tax", "Lacerte",
    "TaxSlayer Pro", "QuickBooks", "Excel", "Adobe Acrobat", "IRS e-Services", "Google Sheets",
  ],
  "Financial Analyst": [
    "Excel", "Google Sheets", "QuickBooks", "NetSuite", "Xero",
    "Tableau", "Power BI", "Bloomberg", "Looker Studio", "Notion",
  ],
  // ── Administrative ──
  "Administrative Assistant": [
    "Google Workspace", "Microsoft 365", "Zoom", "Slack", "Asana",
    "Trello", "Calendly", "HubSpot", "Notion", "Dropbox",
  ],
  "Executive Assistant": [
    "Google Workspace", "Microsoft 365", "Zoom", "Calendly", "Notion",
    "Slack", "Asana", "Expensify", "Trello", "Dropbox",
  ],
  "Virtual Assistant": [
    "Google Workspace", "Microsoft 365", "Asana", "Trello", "Notion",
    "Slack", "Zoom", "Calendly", "HubSpot", "Airtable",
  ],
  "Office Manager": [
    "Google Workspace", "Microsoft 365", "QuickBooks", "Slack", "Zoom",
    "Asana", "Gusto", "Expensify", "Notion", "Trello",
  ],
  "Data Entry Specialist": [
    "Microsoft Excel", "Google Sheets", "Airtable", "Salesforce", "HubSpot",
    "Zoho CRM", "Notion", "Microsoft Access", "Smartsheet", "Google Forms",
  ],
  "Transcriptionist": [
    "Otter.ai", "Rev", "Microsoft Word", "Express Scribe", "oTranscribe",
    "Google Docs", "Descript", "Trint", "Zoom", "Adobe Audition",
  ],
  // ── Sales & Outreach ──
  "Cold Caller": [
    "HubSpot", "Salesforce", "Pipedrive", "Dialpad", "RingCentral",
    "Outreach", "Apollo.io", "Close", "Zoom", "Slack",
  ],
  "Sales Representative": [
    "HubSpot", "Salesforce", "Pipedrive", "Zoom", "Outreach",
    "Apollo.io", "LinkedIn Sales Navigator", "Slack", "Close", "Google Workspace",
  ],
  "Sales Development Representative (SDR)": [
    "Outreach", "Salesloft", "HubSpot", "Salesforce", "Apollo.io",
    "LinkedIn Sales Navigator", "ZoomInfo", "Slack", "Close", "Zoom",
  ],
  "Appointment Setter": [
    "HubSpot", "Salesforce", "Calendly", "Pipedrive", "Dialpad",
    "RingCentral", "Close", "Outreach", "Zoom", "Slack",
  ],
  "Account Manager": [
    "HubSpot", "Salesforce", "Pipedrive", "Zoom", "Slack",
    "Notion", "Asana", "Microsoft 365", "Google Workspace", "Gainsight",
  ],
  "Lead Generation Specialist": [
    "Apollo.io", "ZoomInfo", "LinkedIn Sales Navigator", "HubSpot",
    "Salesforce", "Hunter.io", "Lusha", "Instantly", "Lemlist", "Google Sheets",
  ],
  // ── Marketing & SEO ──
  "Social Media Manager": [
    "Hootsuite", "Buffer", "Sprout Social", "Canva", "Later",
    "Meta Business Suite", "TikTok Ads Manager", "Google Analytics", "Notion", "Slack",
  ],
  "Content Writer": [
    "Google Docs", "WordPress", "Notion", "Grammarly", "Surfer SEO",
    "SEMrush", "Ahrefs", "Canva", "Hemingway Editor", "HubSpot",
  ],
  "SEO Specialist": [
    "Ahrefs", "SEMrush", "Google Search Console", "Moz", "Surfer SEO",
    "Screaming Frog", "Google Analytics", "WordPress", "Looker Studio", "Yoast",
  ],
  "Paid Ads Specialist": [
    "Google Ads", "Meta Ads Manager", "LinkedIn Ads", "TikTok Ads Manager",
    "Google Analytics", "Looker Studio", "Canva", "ClickUp", "Hotjar", "Slack",
  ],
  "Email Marketing Specialist": [
    "Mailchimp", "Klaviyo", "ActiveCampaign", "HubSpot", "Constant Contact",
    "ConvertKit", "Zapier", "Google Analytics", "Canva", "Beehiiv",
  ],
  "CRM Manager": [
    "HubSpot", "Salesforce", "Pipedrive", "Zoho CRM", "ActiveCampaign",
    "Zapier", "Airtable", "Slack", "Monday.com", "Google Sheets",
  ],
  // ── Scheduling & Support ──
  "Scheduling Coordinator": [
    "Calendly", "Acuity", "Google Calendar", "Outlook", "Mindbody",
    "Jane App", "Zoom", "Slack", "OpenDental", "Dentrix",
  ],
  "Customer Support Representative": [
    "Zendesk", "Intercom", "Freshdesk", "Gorgias", "HubSpot",
    "Salesforce", "Slack", "LiveChat", "Front", "Zoom",
  ],
  // ── Medical ──
  "Medical Billing Specialist": [
    "Kareo", "AdvancedMD", "eClinicalWorks", "Athenahealth", "DrChrono",
    "Excel", "Change Healthcare", "Availity", "Waystar", "Outlook",
  ],
  "Medical Administrative Assistant": [
    "Epic", "Cerner", "Athenahealth", "Kareo", "DrChrono",
    "Microsoft 365", "Zoom", "Outlook", "Google Workspace", "AdvancedMD",
  ],
  "Insurance Verification Specialist": [
    "Availity", "Kareo", "Epic", "eClinicalWorks", "Athenahealth",
    "Excel", "Change Healthcare", "Outlook", "Waystar", "Cerner",
  ],
  "Dental Office Administrator": [
    "Dentrix", "Eaglesoft", "OpenDental", "Carestream", "Dolphin",
    "Microsoft 365", "Zoom", "Outlook", "Google Workspace", "Dentimax",
  ],
  // ── Real Estate ──
  "Real Estate Assistant": [
    "Follow Up Boss", "Chime", "DocuSign", "Dotloop", "MLS",
    "Google Workspace", "Trello", "Canva", "Zoom", "Slack",
  ],
  "Transaction Coordinator": [
    "Dotloop", "DocuSign", "SkySlope", "Zipforms", "MLS",
    "Google Workspace", "Trello", "Outlook", "Notary Cam", "Slack",
  ],
  // ── HR & Recruitment ──
  "HR Assistant": [
    "BambooHR", "Gusto", "ADP", "Rippling", "Workday",
    "Google Workspace", "Zoom", "Slack", "Notion", "Microsoft 365",
  ],
  "Recruitment Coordinator": [
    "LinkedIn Recruiter", "Greenhouse", "Lever", "Workable", "Indeed",
    "BambooHR", "Zoom", "Google Workspace", "Slack", "Calendly",
  ],
  // ── Creative & Design ──
  "Graphic Designer": [
    "Adobe Photoshop", "Adobe Illustrator", "Canva", "Figma", "Adobe InDesign",
    "Adobe After Effects", "Procreate", "Slack", "Google Drive", "Notion",
  ],
  "Video Editor": [
    "Adobe Premiere Pro", "DaVinci Resolve", "Final Cut Pro", "Adobe After Effects",
    "CapCut", "Canva", "Frame.io", "Slack", "Google Drive", "Descript",
  ],
  // ── Operations & E-Commerce ──
  "Project Manager": [
    "Asana", "Monday.com", "Jira", "Trello", "Notion",
    "Slack", "Zoom", "ClickUp", "Google Workspace", "Confluence",
  ],
  "Operations Assistant": [
    "Asana", "Monday.com", "Google Workspace", "Slack", "Notion",
    "Airtable", "Trello", "Zoom", "ClickUp", "Smartsheet",
  ],
  "E-Commerce Manager": [
    "Shopify", "WooCommerce", "Amazon Seller Central", "Google Analytics",
    "Meta Ads Manager", "Klaviyo", "Canva", "Airtable", "Slack", "Looker Studio",
  ],
  "Shopify Manager": [
    "Shopify", "Google Analytics", "Klaviyo", "Canva", "Meta Ads Manager",
    "Airtable", "Slack", "Loox", "Yotpo", "Gorgias",
  ],
  "Amazon Store Manager": [
    "Amazon Seller Central", "Helium 10", "Jungle Scout", "Google Sheets",
    "Airtable", "Canva", "Asana", "Slack", "DataDive", "Keepa",
  ],
};

// SKILLS_BY_ROLE moved to @/lib/roleSkills — one copy, shared with the server.

const INDUSTRIES = [
  "Accounting and Finance",
  "Banking and Financial Services",
  "Consulting",
  "Construction and Real Estate",
  "E-Commerce",
  "Education",
  "Government",
  "Healthcare",
  "Hospitality and Tourism",
  "Human Resources",
  "Insurance",
  "Legal Services",
  "Logistics and Supply Chain",
  "Manufacturing",
  "Marketing and Advertising",
  "Media and Entertainment",
  "Non-Profit",
  "Real Estate",
  "Retail",
  "Technology and SaaS",
  "Other",
];

const DURATIONS = [
  "Less than 1 year",
  "1 to 2 years",
  "2 to 5 years",
  "5+ years",
];


// ─── Work-entry tag entry ───
//
// Controlled, so the Add button has a value to read — the originals were
// uncontrolled and pulled the value off the keydown event, which a button
// cannot do.
//
// The bug this fixes: on a phone the keyboard shows "next" rather than
// "return", because these inputs sit in a form with more fields below, and
// "next" moves focus WITHOUT firing a keydown for Enter. The typed word was
// dropped and the form advanced. Enter still works where the keyboard sends it;
// the button and the blur handler cover where it does not.
function WorkEntryTagInput({ placeholder, onAdd, disabled }: {
  placeholder: string;
  onAdd: (value: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");

  function commit() {
    const v = value.trim().replace(/,+$/, "");
    if (v) onAdd(v);
    setValue("");
  }

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        enterKeyHint="done"
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          }
        }}
        className="block w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
      />
      <button
        type="button"
        onClick={commit}
        disabled={disabled || !value.trim()}
        className="shrink-0 rounded-lg border border-primary px-3 py-2 text-sm font-medium text-primary hover:bg-primary hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-primary"
      >
        Add
      </button>
    </div>
  );
}

export default function ProfileBuilder({
  candidateId,
  candidateData,
  onComplete,
}: ProfileBuilderProps) {
  const [currentStep, setCurrentStep] = useState<BuilderStep>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Step 1 — Photo and Basic Info
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  // Seeded from the saved photo. It was not, so a candidate returning to the
  // builder with a photo already on their profile was told "Profile photo is
  // required" and had to find and re-upload the same file to get past step 1.
  const [photoPreview, setPhotoPreview] = useState<string | null>(
    candidateData.profile_photo_url || null
  );
  // Seeded, like bio and hourly_rate. Candidates who entered a tagline under
  // the older application flow should not have to retype it here.
  const [tagline, setTagline] = useState(candidateData.tagline || "");
  const [hourlyRate, setHourlyRate] = useState(candidateData.hourly_rate || 0);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const portfolioInputRef = useRef<HTMLInputElement>(null);

  // Step 2 — About
  const [bio, setBio] = useState(candidateData.bio || "");

  // Step 3 — Tools
  const roleTools = TOOLS_BY_ROLE[candidateData.role_category] || TOOLS_BY_ROLE["Admin"];
  const roleSkills = SKILLS_BY_ROLE[candidateData.role_category] ?? [];
  const [selectedTools, setSelectedTools] = useState<string[]>(candidateData.tools || []);
  // candidates.skills drives a browse facet and was NEVER written by this
  // builder — SKILLS_BY_ROLE was imported, a roleSkills array computed, and
  // then nothing rendered it. Step 3 now collects them.
  const [selectedSkills, setSelectedSkills] = useState<string[]>(candidateData.skills || []);

  // Step 4 — Work Experience
  const [workEntries, setWorkEntries] = useState<WorkEntry[]>(() => {
    // Seed from what the candidate already saved. Without this, a returning
    // candidate got a blank form and their stored references — keyed to
    // entries that no longer existed in state — could never be matched again.
    const saved = (candidateData.work_experience as WorkEntry[] | null) || [];
    if (saved.length) {
      return saved.map((e) => ({ ...e, ref_key: e.ref_key || newEmployerKey() }));
    }
    return [
      { ref_key: newEmployerKey(), company_name: "", role_title: "", industry: "", industry_other: "", duration: "", description: "", start_date: "", end_date: "", tools_used: [], skills_gained: [] },
    ];
  });

  // Step 5 — Portfolio and Resume
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  // References are keyed by employer, not by array index: reordering or
  // deleting an entry must not silently re-point somebody's reference at a
  // different job. The key is derived from the company name and start date.
  const { byEmployer: savedReferences, setByEmployer: setSavedReferences } = useSavedReferences();
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [payoutMethod, setPayoutMethod] = useState("");

  // Step 6 — Availability + Consent
  // Step 7 — Education and certifications, both optional.
  const [educationEntries, setEducationEntries] = useState<EducationEntry[]>(
    (candidateData.education as EducationEntry[] | null) || []
  );
  const [certifications, setCertifications] = useState<string[]>(
    (candidateData.certifications as string[] | null) || []
  );

  // Step 1 additions, to match Atlas's basic-info step.
  const [city, setCity] = useState(candidateData.city || "");
  const [roleTitle, setRoleTitle] = useState(candidateData.role_title || "");
  // Capacity OFFERED. Deliberately not committed_hours, which means hours
  // already booked — match/route.ts computes `available = 50 - committed`.
  const [hoursPerWeek, setHoursPerWeek] = useState<number>(candidateData.hours_per_week || 40);
  const [workingHours, setWorkingHours] = useState(candidateData.working_hours || "");

  const [availability, setAvailability] = useState<string>("");
  const [availabilityDate, setAvailabilityDate] = useState("");
  const [interviewConsent, setInterviewConsent] = useState(false);

  // Derived, never stored. See lib/profileCompleteness.
  const completeness = profileCompleteness({
    profile_photo_url: photoPreview || candidateData.profile_photo_url || null,
    display_name: candidateData.display_name || candidateData.full_name,
    city,
    country: candidateData.country || null,
    role_title: roleTitle,
    tagline,
    bio,
    hourly_rate: hourlyRate,
    hours_per_week: hoursPerWeek,
    payout_method: payoutMethod,
    skills: selectedSkills,
    tools: selectedTools,
    work_experience: workEntries.filter((e) => e.role_title.trim()),
    resume_url: resumeFile ? "pending" : candidateData.resume_url || null,
    video_intro_url: candidateData.video_intro_url || null,
    voice_recording_2_url: candidateData.voice_recording_2_url || null,
  });

  const firstName = candidateData.full_name?.split(" ")[0] || "";
  const lastInitial = candidateData.full_name?.split(" ")[1]?.[0] || "";
  const displayName = `${firstName} ${lastInitial}.`;

  const [showCropper, setShowCropper] = useState(false);
  const [rawImageUrl, setRawImageUrl] = useState<string | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const cropImgRef = useRef<HTMLImageElement>(null);

  const handlePhotoChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file (JPG or PNG)");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("Photo must be under 5MB");
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      if (img.width < 200 || img.height < 200) {
        setError("Photo must be at least 200x200 pixels");
        return;
      }
      setError("");
      setRawImageUrl(URL.createObjectURL(file));
      setShowCropper(true);
    };
    img.src = URL.createObjectURL(file);
  }, []);

  function applyCrop() {
    if (!rawImageUrl) return;

    const img = new window.Image();
    img.onload = () => {
      const outSize = 400; // output pixel size
      const canvas = document.createElement("canvas");
      canvas.width = outSize;
      canvas.height = outSize;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // The crop container is 280x280 CSS pixels.
      // The image is rendered with min-width:100% and min-height:100%,
      // meaning its shorter dimension fills 280px exactly.
      const containerSize = 280;

      // Rendered scale: how many CSS pixels per natural pixel
      const renderedScale = containerSize / Math.min(img.width, img.height);

      // The image's rendered size in CSS pixels (before zoom)
      const renderedW = img.width * renderedScale;
      const renderedH = img.height * renderedScale;

      // With zoom applied, the image is scaled up further
      const zoomedW = renderedW * cropZoom;
      const zoomedH = renderedH * cropZoom;

      // The visible crop area (280x280) maps to this region of the zoomed image.
      // The image center is at (zoomedW/2 + offsetX, zoomedH/2 + offsetY) in CSS coords.
      // The crop window center is at (140, 140).
      // So the crop window's top-left in zoomed-image coords is:
      const cropLeftInZoomed = (zoomedW / 2 + cropOffset.x) - containerSize / 2;
      const cropTopInZoomed = (zoomedH / 2 + cropOffset.y) - containerSize / 2;

      // Convert from zoomed CSS coords to natural image pixels:
      const pixelsPerCSS = 1 / (renderedScale * cropZoom);
      const sx = Math.max(0, cropLeftInZoomed * pixelsPerCSS);
      const sy = Math.max(0, cropTopInZoomed * pixelsPerCSS);
      const sSize = containerSize * pixelsPerCSS;

      // Clamp to image bounds
      const clampedSx = Math.min(sx, Math.max(0, img.width - sSize));
      const clampedSy = Math.min(sy, Math.max(0, img.height - sSize));
      const clampedSize = Math.min(sSize, img.width - clampedSx, img.height - clampedSy);

      // Draw cropped square (no circle clip — let CSS handle rounded display)
      ctx.drawImage(img, clampedSx, clampedSy, clampedSize, clampedSize, 0, 0, outSize, outSize);

      canvas.toBlob((blob) => {
        if (blob) {
          const croppedFile = new File([blob], "profile-photo.jpg", { type: "image/jpeg" });
          setPhotoFile(croppedFile);
          setPhotoPreview(URL.createObjectURL(blob));
        }
        setShowCropper(false);
        setRawImageUrl(null);
        setCropOffset({ x: 0, y: 0 });
        setCropZoom(1);
      }, "image/jpeg", 0.92);
    };
    img.src = rawImageUrl;
  }

  function cancelCrop() {
    setShowCropper(false);
    setRawImageUrl(null);
    setCropOffset({ x: 0, y: 0 });
    setCropZoom(1);
  }

  function handleCropMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - cropOffset.x, y: e.clientY - cropOffset.y });
  }

  function handleCropMouseMove(e: React.MouseEvent) {
    if (!isDragging) return;
    setCropOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  }

  function handleCropMouseUp() {
    setIsDragging(false);
  }

  function handleCropTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({ x: touch.clientX - cropOffset.x, y: touch.clientY - cropOffset.y });
  }

  function handleCropTouchMove(e: React.TouchEvent) {
    if (!isDragging) return;
    const touch = e.touches[0];
    setCropOffset({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y,
    });
  }

  function toggleTool(tool: string) {
    setSelectedTools((prev) => {
      if (prev.includes(tool)) {
        return prev.filter((t) => t !== tool);
      }
      if (prev.length >= 8) return prev;
      return [...prev, tool];
    });
  }

  function sortWorkEntries(entries: WorkEntry[]): WorkEntry[] {
    return [...entries].sort((a, b) => {
      // Current positions (present/empty end_date) first
      const aIsCurrent = !a.end_date || a.end_date === "present";
      const bIsCurrent = !b.end_date || b.end_date === "present";
      if (aIsCurrent && !bIsCurrent) return -1;
      if (!aIsCurrent && bIsCurrent) return 1;

      // Both current — sort by start_date descending
      if (aIsCurrent && bIsCurrent) return (b.start_date || "").localeCompare(a.start_date || "");

      // Both have end dates — sort by end_date descending, then start_date descending
      const endCompare = (b.end_date || "").localeCompare(a.end_date || "");
      if (endCompare !== 0) return endCompare;
      return (b.start_date || "").localeCompare(a.start_date || "");
    });
  }

  function addWorkEntry() {
    if (workEntries.length >= 3) return;
    // Insert new entry at top (most recent position)
    setWorkEntries([
      { ref_key: newEmployerKey(), company_name: "", role_title: "", industry: "", industry_other: "", duration: "", description: "", start_date: "", end_date: "", tools_used: [], skills_gained: [] },
      ...workEntries,
    ]);
  }

  function removeWorkEntry(index: number) {
    setWorkEntries(workEntries.filter((_, i) => i !== index));
  }

  function updateWorkEntry(index: number, field: keyof WorkEntry, value: string | string[]) {
    const updated = [...workEntries];
    updated[index] = { ...updated[index], [field]: value };
    setWorkEntries(updated);
  }

  function addWorkEntryTag(index: number, field: "tools_used" | "skills_gained", tag: string) {
    const updated = [...workEntries];
    const arr = updated[index][field];
    if (arr.length >= 5 || arr.includes(tag)) return;
    updated[index] = { ...updated[index], [field]: [...arr, tag] };
    setWorkEntries(updated);
  }

  function removeWorkEntryTag(index: number, field: "tools_used" | "skills_gained", tag: string) {
    const updated = [...workEntries];
    updated[index] = { ...updated[index], [field]: updated[index][field].filter(t => t !== tag) };
    setWorkEntries(updated);
  }

  // "Add Portfolio Item" now opens the file picker rather than appending an
  // empty row. The row it used to add contained a bare <input type="file"> next
  // to a full-width bordered text input, so the description box read as the
  // control and the file field looked like nothing — people saw a text box and
  // reasonably concluded there was no way to attach a file.
  function addPortfolioItem() {
    if (portfolioItems.length >= 3) return;
    portfolioInputRef.current?.click();
  }

  // The row is created only once a file has actually been chosen, so an item
  // can never exist without one.
  function handlePortfolioFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset immediately so picking the SAME file again still fires onChange.
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Portfolio file must be under 5MB");
      return;
    }
    if (portfolioItems.length >= 3) return;
    setError("");
    setPortfolioItems([...portfolioItems, { file, description: "" }]);
  }

  function removePortfolioItem(index: number) {
    setPortfolioItems(portfolioItems.filter((_, i) => i !== index));
  }

  function validateStep(): boolean {
    setError("");
    switch (currentStep) {
      case 1:
        if (!photoFile && !photoPreview) {
          setError("Profile photo is required");
          return false;
        }
        if (!roleTitle.trim()) {
          setError("Add the job title you'd want a client to see.");
          return false;
        }
        if (!tagline.trim()) {
          setError("Tagline is required");
          return false;
        }
        if (hourlyRate < 3) {
          setError("Hourly rate must be at least $3/hr");
          return false;
        }
        // The $3 floor is deliberately stricter than the database's $1 — that
        // is a product minimum, and a stricter app rule is fine. The CEILING
        // was missing entirely: 00186 added a CHECK at $500, so without this
        // an out-of-range rate passed every step and then failed the whole
        // submit with a raw constraint error, after the uploads.
        if (hourlyRate > 500) {
          setError("Hourly rate must be $500/hr or less");
          return false;
        }
        return true;
      case 2:
        if (!bio.trim()) {
          setError("Bio is required");
          return false;
        }
        return true;
      case 3:
        if (selectedSkills.length === 0) {
          setError("Select at least one skill");
          return false;
        }
        if (selectedTools.length === 0) {
          setError("Select at least one tool");
          return false;
        }
        return true;
      case 4: {
        const validEntries = workEntries.filter((e) => e.role_title.trim());
        if (validEntries.length === 0) {
          setError("Add at least one work experience entry");
          return false;
        }
        for (const entry of validEntries) {
          if (!entry.company_name?.trim()) {
            setError("Please enter the company or business name.");
            return false;
          }
          if (!entry.industry || !entry.start_date) {
            setError("Each entry needs a role title, industry, and start date");
            return false;
          }
          if (entry.end_date && entry.end_date !== "present" && entry.start_date) {
            const [startYear, startMonth] = entry.start_date.split("-").map(Number);
            const [endYear, endMonth] = entry.end_date.split("-").map(Number);
            const startTotal = startYear * 12 + startMonth;
            const endTotal = endYear * 12 + endMonth;
            if (startTotal > endTotal) {
              setError(`The start date cannot be after the end date for "${entry.role_title || entry.company_name}". Please fix the dates before continuing.`);
              return false;
            }
          }
        }
        return true;
      }
      case 5:
        // An already-uploaded résumé counts. Checking only resumeFile meant a
        // returning candidate whose CV was already on their profile was told
        // "Resume is required" and had to re-upload the same PDF — the same
        // defect the photo check had.
        if (!resumeFile && !candidateData.resume_url) {
          setError("Resume is required");
          return false;
        }
        if (!payoutMethod) {
          setError("Payout method is required");
          return false;
        }
        return true;
      case 7:
        // Education and certifications are optional. Atlas says so, and a
        // Virtual Assistant with fifteen years of experience and no degree is
        // not a worse candidate for leaving it blank.
        return true;
      case 8:
        if (!interviewConsent) {
          setError("Please agree to the interview consent to submit.");
          return false;
        }
        return true;
      case 6:
        if (!availability) {
          setError("Select your availability");
          return false;
        }
        if (!hoursPerWeek || hoursPerWeek < 1 || hoursPerWeek > 60) {
          setError("Enter how many hours a week you want to work (1-60).");
          return false;
        }
        if (availability === "available_by_date" && !availabilityDate) {
          setError("Select a date");
          return false;
        }
        return true;
      default:
        return true;
    }
  }

  // Was the form repopulated from an autosaved draft? Shown once, so the
  // candidate knows why fields they do not remember filling are filled.
  const [draftRestored, setDraftRestored] = useState(false);
  // Set by the first real interaction. Guards the draft loader against
  // clobbering keystrokes that beat a slow fetch.
  const touchedRef = useRef(false);

  /**
   * Load the autosaved draft on mount.
   *
   * Without this the autosave was write-only — it saved on every step and
   * nothing ever read it back, which is worse than not saving at all: it looks
   * like recovery exists and it does not.
   *
   * Applying it wholesale is correct because submit DELETEs the draft, so a
   * draft that exists is by definition newer than the last save. Fields the
   * draft does not carry (the photo and resume Files, and the references)
   * keep their seeded values.
   */
  useEffect(() => {
    let alive = true;
    // If the candidate has already started typing by the time this resolves,
    // do NOT apply it. On a slow connection the fetch can land seconds in, and
    // overwriting live keystrokes with a stale draft is worse than losing the
    // draft — they can see what they typed; they cannot see what we replaced.
    const startedTyping = () =>
      touchedRef.current;

    fetch("/api/candidate/profile-draft")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.draft || startedTyping()) return;
        // Ignore a draft older than the last real save. The DELETE after
        // submit is fire-and-forget, so a failed one leaves a stale draft
        // behind — and applying it on the next visit would quietly revert a
        // profile the candidate had already completed.
        const savedAt = candidateData.profile_completed_at
          ? Date.parse(candidateData.profile_completed_at)
          : 0;
        const draftAt = d.savedAt ? Date.parse(d.savedAt) : 0;
        if (savedAt && draftAt && draftAt <= savedAt) return;
        const v = d.draft as Record<string, unknown>;
        const str = (k: string, fallback: string) =>
          typeof v[k] === "string" ? (v[k] as string) : fallback;
        const arr = <T,>(k: string, fallback: T[]): T[] =>
          Array.isArray(v[k]) ? (v[k] as T[]) : fallback;

        setCity((c) => str("city", c));
        setRoleTitle((c) => str("roleTitle", c));
        setTagline((c) => str("tagline", c));
        setBio((c) => str("bio", c));
        setWorkingHours((c) => str("workingHours", c));
        setPayoutMethod((c) => str("payoutMethod", c));
        setAvailability((c) => str("availability", c));
        setAvailabilityDate((c) => str("availabilityDate", c));
        if (typeof v.hourlyRate === "number") setHourlyRate(v.hourlyRate);
        if (typeof v.hoursPerWeek === "number") setHoursPerWeek(v.hoursPerWeek);
        setSelectedSkills((c) => arr<string>("selectedSkills", c));
        setSelectedTools((c) => arr<string>("selectedTools", c));
        setCertifications((c) => arr<string>("certifications", c));
        setEducationEntries((c) => arr<EducationEntry>("educationEntries", c));
        // Only replace work history when the draft actually has some — an
        // empty array would wipe entries seeded from the saved profile.
        const drafted = arr<WorkEntry>("workEntries", []);
        if (drafted.length) {
          setWorkEntries(drafted.map((e) => ({ ...e, ref_key: e.ref_key || newEmployerKey() })));
        }
        setDraftRestored(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Autosave the form on every step change.
   *
   * All of this state lived in useState and nowhere else, so a refresh, a
   * closed tab or a dead battery erased it — and eight steps is roughly three
   * times as much to lose as six was. Fire-and-forget: a failed autosave must
   * never interrupt someone mid-form, because their work is still on screen.
   */
  const saveDraft = useCallback(() => {
    const draft = {
      city, roleTitle, tagline, bio, hourlyRate, hoursPerWeek, workingHours,
      selectedSkills, selectedTools, workEntries, educationEntries,
      certifications, payoutMethod, availability, availabilityDate,
      // Deliberately NOT saved: photoFile and resumeFile are File objects and
      // do not serialise, and savedReferences holds a third party's contact
      // details, which belong in candidate_references and nowhere else.
    };
    fetch("/api/candidate/profile-draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft }),
      keepalive: true,
    }).catch(() => {});
  }, [city, roleTitle, tagline, bio, hourlyRate, hoursPerWeek, workingHours,
      selectedSkills, selectedTools, workEntries, educationEntries,
      certifications, payoutMethod, availability, availabilityDate]);

  function nextStep() {
    if (!validateStep()) return;
    saveDraft();
    setCurrentStep((prev) => Math.min(prev + 1, LAST_STEP) as BuilderStep);
    setError("");
  }

  function prevStep() {
    setCurrentStep((prev) => Math.max(prev - 1, 1) as BuilderStep);
    setError("");
  }

  async function handleSubmit() {
    if (!validateStep()) return;

    if (!interviewConsent) {
      setError("You must agree to the interview consent to submit your profile.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const supabase = createClient();

      // Upload profile photo
      let photoUrl = "";
      if (photoFile) {
        const ext = photoFile.name.split(".").pop();
        const path = `${candidateId}/photo-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("profile-photos")
          .upload(path, photoFile);

        if (uploadError) throw new Error("Failed to upload photo: " + uploadError.message);

        const { data: urlData } = supabase.storage
          .from("profile-photos")
          .getPublicUrl(path);
        photoUrl = urlData.publicUrl;
      }

      // Upload resume
      let resumeUrl = "";
      if (resumeFile) {
        const path = `${candidateId}/resume-${Date.now()}.pdf`;
        const { error: uploadError } = await supabase.storage
          .from("resumes")
          .upload(path, resumeFile);

        if (uploadError) throw new Error("Failed to upload resume: " + uploadError.message);

        const { data: urlData } = supabase.storage
          .from("resumes")
          .getPublicUrl(path);
        resumeUrl = urlData.publicUrl;
      }

      // Upload portfolio items
      for (let i = 0; i < portfolioItems.length; i++) {
        const item = portfolioItems[i];
        if (!item.file) continue;

        const ext = item.file.name.split(".").pop();
        const path = `${candidateId}/portfolio-${i}-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("portfolio")
          .upload(path, item.file);

        if (uploadError) throw new Error("Failed to upload portfolio item: " + uploadError.message);

        const { data: urlData } = supabase.storage
          .from("portfolio")
          .getPublicUrl(path);

        // The upload above is checked; this row insert was not, so a file could
        // land in storage while the record pointing at it silently failed —
        // leaving the candidate with a portfolio item that uploaded fine and
        // then does not exist.
        const { error: itemError } = await supabase.from("portfolio_items").insert({
          candidate_id: candidateId,
          file_url: urlData.publicUrl,
          file_type: item.file.type.includes("pdf") ? "pdf" : "image",
          description: item.description || null,
          display_order: i,
        });

        if (itemError) {
          throw new Error("Failed to save portfolio item: " + itemError.message);
        }
      }

      // Filter valid work entries
      const validWorkEntries = sortWorkEntries(workEntries.filter((e) => e.role_title.trim()));


      // Update candidate record
      const updateData: Record<string, unknown> = {
        tagline,
        role_title: roleTitle || null,
        city: city || null,
        hourly_rate: hourlyRate,
        // Capacity offered. NOT committed_hours — see the column comment on
        // hours_per_week in migration 00182.
        hours_per_week: hoursPerWeek || null,
        working_hours: workingHours || null,
        bio,
        tools: selectedTools,
        // candidates.skills drives a browse facet and this builder never
        // wrote it before step 11.
        skills: selectedSkills,
        education: educationEntries.filter((e) => e.school.trim() || e.qualification.trim()),
        certifications,
        work_experience: validWorkEntries,
        payout_method: payoutMethod,
        availability_status: availability,
        availability_date:
          availability === "available_by_date" ? availabilityDate : null,
        // admin_status is deliberately NOT set here. This write is unguarded and
        // fired on every save, so it would knock an already-approved candidate
        // back to 'active' — taking their live profile off the marketplace —
        // simply for editing their availability. handleProfileComplete, which
        // runs immediately after this via onComplete(), sets 'active' properly
        // and skips the statuses that must not be overwritten.
        profile_completed_at: new Date().toISOString(),
        interview_consent: interviewConsent,
        interview_consent_at: interviewConsent ? new Date().toISOString() : null,
        interview_consent_version: interviewConsent ? "v1.0" : null,
      };

      if (photoUrl) updateData.profile_photo_url = photoUrl;
      if (resumeUrl) updateData.resume_url = resumeUrl;

      const { error: updateError } = await supabase
        .from("candidates")
        .update(updateData)
        .eq("id", candidateId);

      if (updateError) throw new Error("Failed to save profile: " + updateError.message);

      // Notify admin
      try {
        await fetch("/api/candidate/notify-admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId }),
        });
      } catch {
        // Non-critical
      }

      // References go LAST, and a failure here no longer aborts the submit.
      //
      // The loop used to run before the candidate update and return early on
      // the first rejected reference — after the portfolio rows had already
      // been inserted. A bad reference email therefore meant the profile did
      // not save while the portfolio rows did, and pressing Submit again
      // inserted them a second time (portfolio_items has no unique
      // constraint). The profile is what the candidate came to save; an
      // optional contact our validator disliked must not hold it hostage.
      const referenceErrors: string[] = [];
      for (const entry of validWorkEntries) {
        const key = employerKeyFor(entry);
        const ref = savedReferences[key];
        if (!ref) continue;
        // A part-filled reference is not an error — it is simply not saved.
        if (!ref.email?.trim() || !ref.consent) continue;
        const refError = await saveReference(key, ref);
        if (refError) referenceErrors.push(`${entry.company_name || "that role"}: ${refError}`);
      }
      if (referenceErrors.length) {
        // Said out loud, but after the fact: the profile IS saved.
        setError(
          `Your profile is saved. We couldn't store ${referenceErrors.length === 1 ? "one reference" : "some references"} — ${referenceErrors[0]}. You can fix that from your profile.`
        );
      }

      // The draft is scratch space and the real thing is now saved. Leaving it

      // behind would repopulate a stale form the next time they open the builder.

      fetch("/api/candidate/profile-draft", { method: "DELETE" }).catch(() => {});


      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
  }

  // Each label names what is actually ON that step. "Rate" sat over the
  // availability step while the rate field lives on step 1, and "Portfolio"
  // over a step whose only required field is the résumé.
  const stepLabels = [
    "Basics",
    "About",
    "Skills",
    "Experience",
    "Résumé",
    "Availability",
    "Education",
    "Review",
  ];

  return (
    <div
      className="mx-auto max-w-2xl px-6 py-12"
      onInput={() => {
        touchedRef.current = true;
      }}
      onPointerDown={() => {
        touchedRef.current = true;
      }}
    >
      <h1 className="text-2xl font-bold text-text">Build Your Profile</h1>
      <p className="mt-1 text-sm text-text/60">
        Complete your profile so clients can find and hire you.
      </p>

      {/* Say so. Fields filling themselves with no explanation reads as a bug,
          and a candidate who does not know their work was kept will redo it. */}
      {draftRestored && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-sm text-text/70">
            We picked up where you left off. Everything you had filled in is still here.
          </p>
        </div>
      )}

      {/* Step indicators */}
      <div className="mt-8 flex items-center gap-1">
        {stepLabels.map((label, i) => (
          <div key={label} className="flex-1">
            <div
              className={`h-2 rounded-full transition-colors ${
                i + 1 <= currentStep ? "bg-primary" : "bg-gray-200"
              }`}
            />
            <p
              className={`mt-1 text-xs ${
                i + 1 === currentStep
                  ? "font-semibold text-primary"
                  : "text-text/40"
              }`}
            >
              {label}
            </p>
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-4 text-sm font-medium text-red-600">{error}</p>
      )}

      <div className="mt-8">
        {/* ───────── STEP 1: Photo & Basic Info ───────── */}
        {currentStep === 1 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-text">
                Profile Photo <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-text/50">
                Min 200×200px. JPG or PNG. Max 5MB. Will be cropped to a square.
              </p>
              <div className="mt-3 flex items-center gap-6">
                <div
                  onClick={() => photoInputRef.current?.click()}
                  className="flex h-28 w-28 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-gray-300 bg-gray-50 transition-colors hover:border-primary"
                >
                  {photoPreview ? (
                    <img
                      src={photoPreview}
                      alt="Preview"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="text-center">
                      <svg className="mx-auto h-8 w-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                      </svg>
                      <p className="mt-1 text-[10px] text-gray-400">Upload</p>
                    </div>
                  )}
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-text hover:bg-gray-50"
                  >
                    {photoPreview ? "Change Photo" : "Upload Your Photo"}
                  </button>
                  {photoPreview && (
                    <p className="mt-1 text-xs text-green-600">Photo ready — cropped to square</p>
                  )}
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handlePhotoChange}
                  className="hidden"
                />
              </div>

              {/* Cropper modal */}
              {showCropper && rawImageUrl && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={cancelCrop}>
                  <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                    <h3 className="text-lg font-semibold text-text mb-2">Crop Your Photo</h3>
                    <p className="text-xs text-text/50 mb-4">Drag the image to position it within the circle. Use the slider to zoom.</p>
                    <div className="flex items-center justify-center rounded-lg bg-gray-900 p-4">
                      <div
                        className="relative overflow-hidden select-none"
                        style={{ width: 280, height: 280, cursor: isDragging ? "grabbing" : "grab" }}
                        onMouseDown={handleCropMouseDown}
                        onMouseMove={handleCropMouseMove}
                        onMouseUp={handleCropMouseUp}
                        onMouseLeave={handleCropMouseUp}
                        onTouchStart={handleCropTouchStart}
                        onTouchMove={handleCropTouchMove}
                        onTouchEnd={() => setIsDragging(false)}
                      >
                        <img
                          ref={cropImgRef}
                          src={rawImageUrl}
                          alt="Crop"
                          draggable={false}
                          className="absolute"
                          style={{
                            left: `calc(50% + ${cropOffset.x}px)`,
                            top: `calc(50% + ${cropOffset.y}px)`,
                            transform: `translate(-50%, -50%) scale(${cropZoom})`,
                            minWidth: "100%",
                            minHeight: "100%",
                            maxWidth: "none",
                          }}
                        />
                        {/* Circle overlay mask */}
                        <div className="absolute inset-0 pointer-events-none" style={{
                          boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
                          borderRadius: "50%",
                        }} />
                        <div className="absolute inset-0 pointer-events-none rounded-full border-2 border-white/50" />
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-3">
                      <svg className="h-4 w-4 text-text/40" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM13.5 10.5h-6" />
                      </svg>
                      <input
                        type="range"
                        min="1"
                        max="3"
                        step="0.05"
                        value={cropZoom}
                        onChange={(e) => setCropZoom(parseFloat(e.target.value))}
                        className="flex-1 accent-primary"
                      />
                      <svg className="h-4 w-4 text-text/40" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
                      </svg>
                    </div>
                    <div className="mt-4 flex gap-2 justify-end">
                      <button onClick={cancelCrop} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-text hover:bg-gray-50">
                        Cancel
                      </button>
                      <button onClick={applyCrop} className="rounded-lg bg-primary px-6 py-2 text-sm font-semibold text-white hover:bg-primary/90">
                        Crop & Save
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-text">
                Display Name
              </label>
              <p className="mt-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-text/70">
                {displayName}
              </p>
              <p className="mt-1 text-xs text-text/40">
                Auto-generated for privacy. Clients see first name + last initial.
              </p>
            </div>

            {/* Atlas's basic-info step also carries a location and a job
                title. role_category stays the taxonomy value that drives
                routing and the Interview 2 task; this is what the candidate
                calls themselves, shown on the profile. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="roleTitle" className="block text-sm font-medium text-text">
                  Your job title <span className="text-red-500">*</span>
                </label>
                <input
                  id="roleTitle"
                  type="text"
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  placeholder="e.g. Executive Assistant"
                  maxLength={80}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-text/40">
                  How you&apos;d describe yourself. We match you to work as{" "}
                  {/^[AEIOU]/i.test(candidateData.role_category || "") ? "an" : "a"}{" "}
                  {candidateData.role_category}.
                </p>
              </div>
              <div>
                <label htmlFor="city" className="block text-sm font-medium text-text">
                  City
                </label>
                <input
                  id="city"
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Cebu City"
                  maxLength={80}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-text/40">
                  Optional. Clients see {candidateData.country || "your country"}; your city
                  helps us match you on time-zone overlap.
                </p>
              </div>
            </div>

            <div>
              <label htmlFor="tagline" className="block text-sm font-medium text-text">
                Tagline <span className="text-red-500">*</span>
              </label>
              <input
                id="tagline"
                type="text"
                maxLength={80}
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="e.g. Paralegal with 5 years US client experience"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-text/40">{tagline.length}/80</p>
            </div>

            <div>
              <label htmlFor="rate" className="block text-sm font-medium text-text">
                Hourly Rate (USD) <span className="text-red-500">*</span>
              </label>
              <input
                id="rate"
                type="number"
                min={3}
                value={hourlyRate || ""}
                onChange={(e) => setHourlyRate(parseInt(e.target.value) || 0)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-gray-400">Minimum $3/hr. Clients see this rate on your profile.</p>
            </div>
          </div>
        )}

        {/* ───────── STEP 2: About ───────── */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <div>
              <label htmlFor="bio" className="block text-sm font-medium text-text">
                About You <span className="text-red-500">*</span>
              </label>
              <textarea
                id="bio"
                maxLength={300}
                rows={5}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell clients about your background and what you bring to the role."
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-text/40">{bio.length}/300</p>
            </div>
          </div>
        )}

        {/* ───────── STEP 3: Tools & Software ───────── */}
        {currentStep === 3 && (
          <div className="space-y-6">
            {/* Skills, from the role taxonomy. This block is new: the browse
                facet reads candidates.skills and this builder never wrote it —
                roleSkills was computed and then never rendered. */}
            <div>
              <h3 className="text-sm font-medium text-text">
                Skills <span className="text-red-500">*</span>
              </h3>
              <p className="text-xs text-text/50">
                Pick the ones you&apos;d be comfortable being hired for. Clients filter on these.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {roleSkills.map((skill) => {
                  const on = selectedSkills.includes(skill);
                  return (
                    <button
                      key={skill}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setSelectedSkills(
                          on
                            ? selectedSkills.filter((x) => x !== skill)
                            : [...selectedSkills, skill]
                        )
                      }
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        on
                          ? "border-primary bg-primary text-white"
                          : "border-gray-300 bg-white text-text/70 hover:border-primary"
                      }`}
                    >
                      {skill}
                    </button>
                  );
                })}
              </div>
              {roleSkills.length === 0 && (
                <div className="mt-2">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {selectedSkills.map((sk) => (
                      <span
                        key={sk}
                        className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs text-green-700"
                      >
                        {sk}
                        <button
                          type="button"
                          onClick={() => setSelectedSkills(selectedSkills.filter((x) => x !== sk))}
                          className="text-green-500 hover:text-green-700"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  {/* Roles outside the taxonomy — "STR Property Manager",
                      "Qualitative Researcher" — get a free-text field rather
                      than an empty list. */}
                  <WorkEntryTagInput
                    placeholder="Type a skill, then tap Add"
                    disabled={selectedSkills.length >= 12}
                    onAdd={(v) => {
                      if (!selectedSkills.includes(v) && selectedSkills.length < 12) {
                        setSelectedSkills([...selectedSkills, v]);
                      }
                    }}
                  />
                </div>
              )}
              <p className="mt-2 text-xs text-text/40">
                {selectedSkills.length} selected. Clients filter by individual skills, so
                each one you add is another search you can turn up in.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-medium text-text">
                Tools & Software <span className="text-red-500">*</span>
              </h3>
              <p className="text-xs text-text/50">
                Select up to 8 tools you actively use. ({selectedTools.length}/8 selected)
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {roleTools.map((tool) => {
                const selected = selectedTools.includes(tool);
                return (
                  <button
                    key={tool}
                    type="button"
                    onClick={() => toggleTool(tool)}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                      selected
                        ? "border-primary bg-primary text-white"
                        : "border-gray-300 bg-white text-text hover:border-primary hover:text-primary"
                    } ${
                      !selected && selectedTools.length >= 8
                        ? "cursor-not-allowed opacity-40"
                        : ""
                    }`}
                  >
                    {tool}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ───────── STEP 4: Work Experience ───────── */}
        {currentStep === 4 && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-medium text-text">
                Work Experience <span className="text-red-500">*</span>
              </h3>
              <p className="text-xs text-text/50">Add up to 3 entries.</p>
            </div>
            {workEntries.map((entry, i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-200 bg-white p-5 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-text">
                    Entry {i + 1}
                  </span>
                  {workEntries.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeWorkEntry(i)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div>
                  <input
                    type="text"
                    placeholder="e.g. McKinsey & Company, self-employed"
                    value={entry.company_name}
                    maxLength={80}
                    onChange={(e) =>
                      updateWorkEntry(i, "company_name", e.target.value)
                    }
                    className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                  <label className="block text-xs text-text/50 mt-1">Company / Business Name <span className="text-red-500">*</span></label>
                </div>
                <input
                  type="text"
                  placeholder="Role title (e.g. Senior Paralegal)"
                  value={entry.role_title}
                  onChange={(e) =>
                    updateWorkEntry(i, "role_title", e.target.value)
                  }
                  className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <div className="relative">
                  <select
                    value={entry.industry || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setWorkEntries((prev) => {
                        const updated = [...prev];
                        updated[i] = { ...updated[i], industry: val, industry_other: val === "Other" ? updated[i].industry_other || "" : "" };
                        return updated;
                      });
                    }}
                    className="relative z-10 block w-full appearance-none rounded-lg border border-gray-300 bg-white px-4 py-3 pr-10 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Select industry</option>
                    {INDUSTRIES.map((ind) => (
                      <option key={ind} value={ind}>{ind}</option>
                    ))}
                  </select>
                  <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </div>
                {entry.industry === "Other" && (
                  <input
                    type="text"
                    value={entry.industry_other || ""}
                    onChange={(e) => updateWorkEntry(i, "industry_other", e.target.value)}
                    placeholder="Type your industry"
                    maxLength={100}
                    className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                )}
                {/* Start Date */}
                <div>
                  <label className="block text-xs text-text/50 mb-1">Start Date</label>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={entry.start_date?.split("-")[1] || ""}
                      onChange={(e) => {
                        const year = entry.start_date?.split("-")[0] || "";
                        updateWorkEntry(i, "start_date", year ? `${year}-${e.target.value}` : `-${e.target.value}`);
                      }}
                      className="block w-full rounded-lg border border-gray-300 px-3 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                    >
                      <option value="">Month</option>
                      {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m, idx) => (
                        <option key={m} value={String(idx + 1).padStart(2, "0")}>{m}</option>
                      ))}
                    </select>
                    <select
                      value={entry.start_date?.split("-")[0] || ""}
                      onChange={(e) => {
                        const month = entry.start_date?.split("-")[1] || "01";
                        updateWorkEntry(i, "start_date", `${e.target.value}-${month}`);
                      }}
                      className="block w-full rounded-lg border border-gray-300 px-3 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                    >
                      <option value="">Year</option>
                      {Array.from({ length: new Date().getFullYear() - 1969 }, (_, j) => new Date().getFullYear() - j).map((y) => (
                        <option key={y} value={String(y)}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* End Date */}
                <div>
                  <label className="block text-xs text-text/50 mb-1">End Date</label>
                  <label className="mb-2 flex items-center gap-1.5 text-xs text-text/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={entry.end_date === "present"}
                      onChange={(e) => updateWorkEntry(i, "end_date", e.target.checked ? "present" : "")}
                      className="accent-primary h-3.5 w-3.5"
                    />
                    I currently work here
                  </label>
                  {entry.end_date !== "present" && (
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={entry.end_date?.split("-")[1] || ""}
                        onChange={(e) => {
                          const year = entry.end_date?.split("-")[0] || "";
                          updateWorkEntry(i, "end_date", year ? `${year}-${e.target.value}` : `-${e.target.value}`);
                        }}
                        className="block w-full rounded-lg border border-gray-300 px-3 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                      >
                        <option value="">Month</option>
                        {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m, idx) => (
                          <option key={m} value={String(idx + 1).padStart(2, "0")}>{m}</option>
                        ))}
                      </select>
                      <select
                        value={entry.end_date?.split("-")[0] || ""}
                        onChange={(e) => {
                          const month = entry.end_date?.split("-")[1] || "01";
                          updateWorkEntry(i, "end_date", `${e.target.value}-${month}`);
                        }}
                        className="block w-full rounded-lg border border-gray-300 px-3 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                      >
                        <option value="">Year</option>
                        {Array.from({ length: new Date().getFullYear() - 1969 }, (_, j) => new Date().getFullYear() - j).map((y) => (
                          <option key={y} value={String(y)}>{y}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <input
                  type="text"
                  maxLength={120}
                  placeholder="One sentence description (max 120 characters)"
                  value={entry.description}
                  onChange={(e) => updateWorkEntry(i, "description", e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <p className="text-right text-xs text-text/40">{entry.description.length}/120</p>

                {/* Tools Used */}
                <div>
                  <label className="block text-xs font-medium text-text/70 mb-1">Tools used in this role (up to 5)</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {entry.tools_used.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                        {t}
                        <button type="button" onClick={() => removeWorkEntryTag(i, "tools_used", t)} className="text-primary/60 hover:text-primary">×</button>
                      </span>
                    ))}
                  </div>
                  <WorkEntryTagInput
                    placeholder={entry.tools_used.length >= 5 ? "Max 5 reached" : "Type a tool, then tap Add"}
                    disabled={entry.tools_used.length >= 5}
                    onAdd={(v) => addWorkEntryTag(i, "tools_used", v)}
                  />
                </div>

                {/* Skills Gained */}
                <div>
                  <label className="block text-xs font-medium text-text/70 mb-1">Skills gained (up to 5)</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {entry.skills_gained.map((s) => (
                      <span key={s} className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs text-green-700">
                        {s}
                        <button type="button" onClick={() => removeWorkEntryTag(i, "skills_gained", s)} className="text-green-500 hover:text-green-700">×</button>
                      </span>
                    ))}
                  </div>
                  <WorkEntryTagInput
                    placeholder={entry.skills_gained.length >= 5 ? "Max 5 reached" : "Type a skill, then tap Add"}
                    disabled={entry.skills_gained.length >= 5}
                    onAdd={(v) => addWorkEntryTag(i, "skills_gained", v)}
                  />
                </div>

                <ReferenceFields
                  employerKey={employerKeyFor(entry)}
                  employerName={entry.company_name}
                  value={savedReferences[employerKeyFor(entry)]}
                  onChange={(v: ReferenceValue) =>
                    setSavedReferences((prev) => ({ ...prev, [employerKeyFor(entry)]: v }))
                  }
                />
              </div>
            ))}
            {workEntries.length < 3 && (
              <button
                type="button"
                onClick={addWorkEntry}
                className="w-full rounded-lg border-2 border-dashed border-gray-300 py-3 text-sm font-medium text-text/50 hover:border-primary hover:text-primary transition-colors"
              >
                + Add Work Experience
              </button>
            )}
          </div>
        )}

        {/* ───────── STEP 5: Portfolio & Resume ───────── */}
        {currentStep === 5 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-text">
                Resume <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-text/50">PDF only. Max 10MB.</p>
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && file.size > 10 * 1024 * 1024) {
                    setError("Resume must be under 10MB");
                    return;
                  }
                  setResumeFile(file || null);
                  setError("");
                }}
                className="mt-2 block w-full text-sm text-text/70 file:mr-4 file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-primary/20"
              />
              {resumeFile && (
                <p className="mt-1 text-xs text-green-600">
                  ✓ {resumeFile.name}
                </p>
              )}
            </div>

            <div>
              <h3 className="text-sm font-medium text-text">
                Portfolio Items{" "}
                <span className="text-text/40 font-normal">(optional)</span>
              </h3>
              <p className="text-xs text-text/50">
                Up to 3 items. PDF or image, max 5MB each. Examples: a cover letter, work sample, certificate, or project screenshot.
              </p>
              {portfolioItems.map((item, i) => (
                <div
                  key={i}
                  className="mt-3 flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4"
                >
                  <div className="flex-1 space-y-2">
                    {/* The file is chosen before the row exists, so show WHAT is
                        attached rather than an empty picker that looks unfilled. */}
                    <p className="flex items-center gap-2 text-sm font-medium text-text">
                      <span aria-hidden="true" className="text-green-600">✓</span>
                      <span className="truncate">{item.file?.name ?? "No file attached"}</span>
                      {item.file && (
                        <span className="shrink-0 text-xs font-normal text-text/40">
                          {(item.file.size / 1024 / 1024).toFixed(1)}MB
                        </span>
                      )}
                    </p>
                    <input
                      type="text"
                      maxLength={100}
                      placeholder="One-line description"
                      value={item.description}
                      onChange={(e) => {
                        const updated = [...portfolioItems];
                        updated[i] = {
                          ...updated[i],
                          description: e.target.value,
                        };
                        setPortfolioItems(updated);
                      }}
                      className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removePortfolioItem(i)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {/* Hidden: the visible control is the button below, so that
                  clicking "Add Portfolio Item" opens the file dialog, which is
                  what the label promises. */}
              <input
                ref={portfolioInputRef}
                type="file"
                accept=".pdf,image/*"
                onChange={handlePortfolioFilePicked}
                className="hidden"
              />
              {portfolioItems.length < 3 && (
                <button
                  type="button"
                  onClick={addPortfolioItem}
                  className="mt-3 w-full rounded-lg border-2 border-dashed border-gray-300 py-3 text-sm font-medium text-text/50 hover:border-primary hover:text-primary transition-colors"
                >
                  + Add Portfolio Item &mdash; choose a PDF or image
                </button>
              )}
            </div>

            <div>
              <label htmlFor="payout" className="block text-sm font-medium text-text">
                Payout Method <span className="text-red-500">*</span>
              </label>
              <select
                id="payout"
                value={payoutMethod}
                onChange={(e) => setPayoutMethod(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Select payout method</option>
                <option value="payoneer">Payoneer</option>
                <option value="wise">Wise</option>
                <option value="bank_transfer">Local Bank Transfer</option>
              </select>
            </div>
          </div>
        )}

        {/* ───────── STEP 6: Availability ───────── */}
        {currentStep === 6 && (
          <div className="space-y-6">
            {/* Capacity OFFERED. Stored in hours_per_week, never in
                committed_hours — that column means hours already booked, and
                matching computes spare capacity as 50 minus it, so writing
                "I want 40 hours" there would read as "40 already gone". */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="hoursPerWeek" className="block text-sm font-medium text-text">
                  Hours a week you want <span className="text-red-500">*</span>
                </label>
                <input
                  id="hoursPerWeek"
                  type="number"
                  min={1}
                  max={60}
                  value={hoursPerWeek}
                  onChange={(e) => setHoursPerWeek(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-text/40">
                  What you&apos;re looking for, not what you&apos;re already booked for.
                </p>
              </div>
              <div>
                <label htmlFor="workingHours" className="block text-sm font-medium text-text">
                  Hours you prefer to work
                </label>
                <input
                  id="workingHours"
                  type="text"
                  value={workingHours}
                  onChange={(e) => setWorkingHours(e.target.value)}
                  placeholder="e.g. 8am-1pm PHT, flexible for US mornings"
                  maxLength={120}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-text/40">
                  Most clients are in US time zones. Say what overlap you can offer.
                </p>
              </div>
            </div>

            <h3 className="text-sm font-medium text-text">
              When can you start? <span className="text-red-500">*</span>
            </h3>
            <div className="grid gap-4">
              <button
                type="button"
                onClick={() => setAvailability("available_now")}
                className={`rounded-xl border-2 p-5 text-left transition-colors ${
                  availability === "available_now"
                    ? "border-green-500 bg-green-50"
                    : "border-gray-200 bg-white hover:border-green-300"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">🟢</span>
                  <div>
                    <p className="font-semibold text-text">Available Now</p>
                    <p className="text-xs text-text/50">
                      Ready to start immediately
                    </p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAvailability("available_by_date")}
                className={`rounded-xl border-2 p-5 text-left transition-colors ${
                  availability === "available_by_date"
                    ? "border-yellow-500 bg-yellow-50"
                    : "border-gray-200 bg-white hover:border-yellow-300"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">🟡</span>
                  <div>
                    <p className="font-semibold text-text">
                      Available From a Specific Date
                    </p>
                    <p className="text-xs text-text/50">
                      I can start on a future date
                    </p>
                  </div>
                </div>
              </button>
              {availability === "available_by_date" && (
                <input
                  type="date"
                  value={availabilityDate}
                  onChange={(e) => setAvailabilityDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="ml-12 w-auto rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                />
              )}

              <button
                type="button"
                onClick={() => setAvailability("not_available")}
                className={`rounded-xl border-2 p-5 text-left transition-colors ${
                  availability === "not_available"
                    ? "border-gray-500 bg-gray-50"
                    : "border-gray-200 bg-white hover:border-gray-400"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">⚪</span>
                  <div>
                    <p className="font-semibold text-text">
                      Not Available Currently
                    </p>
                    <p className="text-xs text-text/50">
                      I&apos;m not ready to take on work right now
                    </p>
                  </div>
                </div>
              </button>
            </div>

          </div>
        )}

        {/* ───────── STEP 7: Education & Certifications (optional) ───────── */}
        {currentStep === 7 && (
          <div className="mt-8 space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-text">
                Education &amp; certifications{" "}
                <span className="font-normal text-text/50">— optional</span>
              </h3>
              <p className="mt-1 text-xs text-text/50">
                Skip this if it isn&apos;t relevant to your work. It appears on your profile
                for a client reading it; none of it is required to be approved.
              </p>
            </div>

            <div className="space-y-3">
              {educationEntries.map((e, i) => (
                <div key={i} className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-text">Education {i + 1}</span>
                    <button
                      type="button"
                      onClick={() => setEducationEntries(educationEntries.filter((_, x) => x !== i))}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      type="text"
                      placeholder="School or university"
                      aria-label={`School or university, education ${i + 1}`}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      value={e.school}
                      onChange={(ev) => {
                        const u = [...educationEntries];
                        u[i] = { ...u[i], school: ev.target.value };
                        setEducationEntries(u);
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Qualification"
                      aria-label={`Qualification, education ${i + 1}`}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      value={e.qualification}
                      onChange={(ev) => {
                        const u = [...educationEntries];
                        u[i] = { ...u[i], qualification: ev.target.value };
                        setEducationEntries(u);
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Field of study"
                      aria-label={`Field of study, education ${i + 1}`}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      value={e.field}
                      onChange={(ev) => {
                        const u = [...educationEntries];
                        u[i] = { ...u[i], field: ev.target.value };
                        setEducationEntries(u);
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Year finished"
                      aria-label={`Year finished, education ${i + 1}`}
                      inputMode="numeric"
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      value={e.year}
                      onChange={(ev) => {
                        const u = [...educationEntries];
                        u[i] = { ...u[i], year: ev.target.value };
                        setEducationEntries(u);
                      }}
                    />
                  </div>
                </div>
              ))}
              {educationEntries.length < 3 && (
                <button
                  type="button"
                  onClick={() =>
                    setEducationEntries([
                      ...educationEntries,
                      { school: "", qualification: "", field: "", year: "" },
                    ])
                  }
                  className="w-full rounded-lg border-2 border-dashed border-gray-300 py-3 text-sm font-medium text-text/50 hover:border-primary hover:text-primary transition-colors"
                >
                  + Add education
                </button>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-text mb-2">Certifications</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {certifications.map((c) => (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700"
                  >
                    {c}
                    <button
                      type="button"
                      onClick={() => setCertifications(certifications.filter((x) => x !== c))}
                      className="text-blue-500 hover:text-blue-700"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <WorkEntryTagInput
                placeholder={
                  certifications.length >= 8 ? "Max 8 reached" : "e.g. QuickBooks ProAdvisor, then tap Add"
                }
                disabled={certifications.length >= 8}
                onAdd={(v) => {
                  if (certifications.length < 8 && !certifications.includes(v)) {
                    setCertifications([...certifications, v]);
                  }
                }}
              />
            </div>
          </div>
        )}

        {/* ───────── STEP 8: Review & submit ───────── */}
        {currentStep === 8 && (
          <div className="mt-8 space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-text">Here&apos;s how clients will see you</h3>
              <p className="mt-1 text-xs text-text/50">
                Anything still missing is listed below.
              </p>
            </div>

            {/* A checklist, not a score. See lib/profileCompleteness for why
                Atlas's weighted 0-100 "Profile Strength" is deliberately not
                here: nothing ranks on it, reputation_score already exists and
                would disagree with it, and a hidden rubric that decides
                nothing should not be shown as a number. */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <p className="text-sm font-semibold text-text">
                  {completeness.done} of {completeness.total} sections done
                </p>
                <p className="text-xs text-text/50">
                  {/* Counts only what this form can actually capture. Saying
                      "3 still needed to submit" while Submit works, and while
                      two of the three are recorded on a different page, is a
                      false statement in both directions. */}
                  {completeness.blockingHere > 0
                    ? `${completeness.blockingHere} still to fill in above`
                    : completeness.done === completeness.total
                      ? "Everything's in."
                      : "Nothing left on this form — the rest is recorded separately."}
                </p>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${completeness.percent}%` }}
                />
              </div>

              <ul className="mt-4 space-y-2">
                {completeness.sections.map((sec) => (
                  <li key={sec.key} className="flex items-start gap-2.5 text-sm">
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                        sec.done ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"
                      }`}
                      aria-hidden
                    >
                      {sec.done ? "✓" : "·"}
                    </span>
                    <span className="flex-1">
                      <span className={sec.done ? "text-text/70" : "text-text"}>{sec.label}</span>
                      {!sec.required && (
                        <span className="ml-1.5 text-xs text-text/40">optional</span>
                      )}
                      {sec.elsewhere && !sec.done && (
                        <span className="ml-1.5 text-xs text-text/40">recorded separately</span>
                      )}
                      {!sec.done && sec.missing && (
                        <span className="block text-xs text-text/50">{sec.missing}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Voice recording consent */}
            <div className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-5">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={interviewConsent}
                  onChange={(e) => setInterviewConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#FE6E3E] focus:ring-[#FE6E3E]"
                />
                <div>
                  <span className="text-sm text-[#1C1B1A]/70 leading-relaxed">
                    I consent to my voice recordings being made available to registered clients on StaffVA for the purpose of hiring evaluation. I understand my recordings will be visible to logged-in clients browsing my profile.
                  </span>
                  <p className="mt-2 text-xs text-gray-400 italic">
                    Your voice is your strongest profile feature. Clients hear you before they hire you — this is what sets StaffVA apart.
                  </p>
                </div>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="mt-10 flex items-center justify-between">
        {currentStep > 1 ? (
          <button
            type="button"
            onClick={prevStep}
            className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-medium text-text hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
        ) : (
          <div />
        )}

        {currentStep < LAST_STEP ? (
          <button
            type="button"
            onClick={nextStep}
            className="rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || (currentStep === LAST_STEP && !interviewConsent)}
            aria-describedby={
              currentStep === LAST_STEP && !interviewConsent ? "submit-blocked" : undefined
            }
            className="rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            {saving ? "Submitting..." : "Submit Profile"}
          </button>
        )}
        {currentStep === LAST_STEP && !interviewConsent && (
          <p id="submit-blocked" className="mt-3 w-full text-right text-xs text-text/50">
            Tick the recording consent above to submit.
          </p>
        )}
      </div>
    </div>
  );
}
