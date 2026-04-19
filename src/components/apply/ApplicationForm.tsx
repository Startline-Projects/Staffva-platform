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

const SKILLS_BY_ROLE: Record<string, string[]> = {
  // ── Legal ──
  "Paralegal": ["Legal research", "Document drafting", "Case management", "Deposition summaries", "Discovery support", "Court filing", "Client communication", "Contract review"],
  "Legal Assistant": ["Document preparation", "Legal research", "Calendar management", "Client intake", "Filing and docketing", "Correspondence drafting", "Billing support", "Court scheduling"],
  "Legal Secretary": ["Document formatting", "Docket management", "Correspondence drafting", "Records management", "Client communication", "Billing support", "Transcript preparation", "Court scheduling"],
  "Litigation Support": ["Document review", "eDiscovery management", "Trial preparation", "Case chronology", "Deposition summaries", "Evidence organization", "Legal research", "Data room management"],
  "Contract Reviewer": ["Contract analysis", "Risk identification", "Redlining", "Clause comparison", "Legal research", "Summary drafting", "Compliance review", "Document management"],
  // ── Accounting & Finance ──
  "Bookkeeper": ["Bank reconciliation", "Accounts payable", "Accounts receivable", "Expense tracking", "Financial reporting", "Invoice processing", "Payroll support", "Month-end close"],
  "Accounts Payable Specialist": ["Invoice processing", "Vendor management", "Payment scheduling", "Reconciliation", "Expense reporting", "Purchase order matching", "Month-end close", "Compliance tracking"],
  "Accounts Receivable Specialist": ["Invoice generation", "Collections management", "Payment application", "Reconciliation", "Aging report analysis", "Customer billing", "Month-end close", "Dispute resolution"],
  "Payroll Specialist": ["Payroll processing", "Tax withholding", "Benefits administration", "Timekeeping", "Compliance reporting", "Off-cycle payroll", "Reconciliation", "Employee records"],
  "Tax Preparer": ["Tax return preparation", "Client documentation", "Federal and state filings", "Bookkeeping review", "Deduction analysis", "E-filing", "Client communication", "IRS correspondence"],
  "Financial Analyst": ["Financial modeling", "Budget analysis", "Variance reporting", "Forecasting", "KPI tracking", "Data visualization", "P&L analysis", "Investor reporting"],
  // ── Administrative ──
  "Administrative Assistant": ["Calendar management", "Email management", "Document preparation", "Travel coordination", "Data entry", "Meeting coordination", "Expense reporting", "Stakeholder communication"],
  "Executive Assistant": ["Executive calendar management", "Board communications", "Travel planning", "Meeting preparation", "Project coordination", "Expense management", "Confidential correspondence", "Stakeholder management"],
  "Virtual Assistant": ["Calendar management", "Email management", "Research", "Data entry", "Social media scheduling", "Customer service", "Document preparation", "Administrative support"],
  "Office Manager": ["Operations coordination", "Vendor management", "Budget tracking", "HR support", "Onboarding", "Policy documentation", "Scheduling", "Facilities coordination"],
  "Data Entry Specialist": ["Data validation", "Spreadsheet management", "CRM data entry", "Quality checking", "Database management", "Report generation", "Error correction", "Record keeping"],
  "Transcriptionist": ["Audio transcription", "Verbatim transcription", "Timestamping", "Proofreading", "Document formatting", "Medical terminology", "Legal terminology", "Quality assurance"],
  // ── Sales & Outreach ──
  "Cold Caller": ["Prospecting", "Script delivery", "Objection handling", "Lead qualification", "CRM logging", "Follow-up scheduling", "Pipeline management", "Callback coordination"],
  "Sales Representative": ["Lead qualification", "Product presentations", "Proposal writing", "Objection handling", "CRM management", "Deal closing", "Pipeline management", "Client follow-up"],
  "Sales Development Representative (SDR)": ["Lead prospecting", "Cold outreach", "Email sequences", "Qualifying calls", "CRM logging", "Meeting booking", "Account research", "Pipeline building"],
  "Appointment Setter": ["Prospect outreach", "Call handling", "Objection handling", "Calendar coordination", "CRM logging", "Lead qualification", "Follow-up sequences", "Confirmation calls"],
  "Account Manager": ["Client relationship management", "Upselling", "Renewal management", "QBR preparation", "Issue resolution", "Contract management", "Performance reporting", "Stakeholder communication"],
  "Lead Generation Specialist": ["Prospect research", "List building", "Email outreach", "LinkedIn prospecting", "Data enrichment", "CRM management", "Campaign tracking", "Reporting"],
  // ── Marketing & SEO ──
  "Social Media Manager": ["Content creation", "Post scheduling", "Community management", "Analytics reporting", "Campaign management", "Hashtag research", "Audience engagement", "Trend monitoring"],
  "Content Writer": ["Blog writing", "Copywriting", "SEO optimization", "Research", "Editing and proofreading", "Content strategy", "Keyword integration", "Content calendar management"],
  "SEO Specialist": ["Keyword research", "On-page optimization", "Technical SEO audits", "Link building", "Content optimization", "Rank tracking", "Competitor analysis", "Analytics reporting"],
  "Paid Ads Specialist": ["Campaign setup", "Ad copywriting", "A/B testing", "Bid management", "Audience targeting", "Performance reporting", "Budget optimization", "Conversion tracking"],
  "Email Marketing Specialist": ["Campaign creation", "List segmentation", "A/B testing", "Automation setup", "Performance reporting", "Copywriting", "List hygiene", "Deliverability optimization"],
  "CRM Manager": ["CRM configuration", "Pipeline management", "Automation setup", "Data hygiene", "Reporting", "Contact segmentation", "Lead scoring", "Integration management"],
  // ── Scheduling & Support ──
  "Scheduling Coordinator": ["Appointment booking", "Calendar management", "Rescheduling", "Client communication", "Reminder systems", "Schedule optimization", "Documentation", "Intake coordination"],
  "Customer Support Representative": ["Ticket management", "Live chat support", "Email support", "Issue resolution", "Escalation handling", "Knowledge base updates", "Customer communication", "Refund processing"],
  // ── Medical ──
  "Medical Billing Specialist": ["Claims submission", "Denial management", "Insurance verification", "ICD-10 coding", "CPT coding", "EOB reconciliation", "Patient billing", "AR follow-up"],
  "Medical Administrative Assistant": ["Patient scheduling", "Insurance verification", "Medical records management", "EMR data entry", "Prior authorizations", "Patient communication", "Referral coordination", "Billing support"],
  "Insurance Verification Specialist": ["Benefits verification", "Prior authorization", "Eligibility checks", "Coverage documentation", "EOB review", "Patient communication", "Denial follow-up", "Payer coordination"],
  "Dental Office Administrator": ["Patient scheduling", "Dental billing", "Insurance verification", "Treatment plan coordination", "Patient communication", "Records management", "Collections follow-up", "Front desk support"],
  // ── Real Estate ──
  "Real Estate Assistant": ["MLS listing management", "Client coordination", "Document preparation", "Showing scheduling", "Transaction support", "Social media posting", "Email management", "CRM management"],
  "Transaction Coordinator": ["Contract management", "Timeline tracking", "Title coordination", "Escrow management", "Document collection", "Closing coordination", "Communication management", "Compliance review"],
  // ── HR & Recruitment ──
  "HR Assistant": ["Onboarding coordination", "Employee records", "Benefits administration", "Policy compliance", "Job posting", "Interview scheduling", "HR communications", "Offboarding support"],
  "Recruitment Coordinator": ["Job posting", "Resume screening", "Interview scheduling", "Candidate communication", "ATS management", "Offer coordination", "Background check coordination", "Reporting"],
  // ── Creative & Design ──
  "Graphic Designer": ["Brand design", "Social media graphics", "Layout design", "Print design", "Illustration", "Photo editing", "Typography", "File preparation for print/web"],
  "Video Editor": ["Footage editing", "Color grading", "Audio mixing", "Motion graphics", "Subtitling and captions", "Thumbnail design", "Social media video formatting", "Export optimization"],
  // ── Operations & E-Commerce ──
  "Project Manager": ["Project planning", "Timeline management", "Stakeholder communication", "Risk management", "Budget tracking", "Team coordination", "Status reporting", "Process documentation"],
  "Operations Assistant": ["Process documentation", "Vendor coordination", "Data management", "Reporting", "Logistics support", "Internal communication", "Budget tracking", "Workflow optimization"],
  "E-Commerce Manager": ["Product listing", "Inventory management", "Order fulfillment coordination", "Customer service", "Marketing campaigns", "Performance reporting", "Conversion optimization", "Competitor analysis"],
  "Shopify Manager": ["Store management", "Product uploads", "Theme customization", "App integration", "Order management", "SEO optimization", "Analytics reporting", "Customer service"],
  "Amazon Store Manager": ["Listing optimization", "PPC campaign management", "Inventory forecasting", "Review management", "Account health monitoring", "Competitor research", "FBA coordination", "Performance reporting"],
};

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
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-white shadow-2xl lg:absolute lg:top-full lg:bottom-auto lg:left-0 lg:right-0 lg:mt-1 lg:rounded-xl lg:border lg:border-gray-200"
          style={{ maxHeight: "min(85vh, 85dvh)", height: "auto" }}
          onKeyDown={handleKeyDown}
        >
          {/* Mobile drag handle — pinned */}
          <div className="flex justify-center pt-3 pb-1 lg:hidden shrink-0">
            <div className="h-1 w-10 rounded-full bg-gray-300" />
          </div>

          {/* Search input — pinned */}
          <div className="px-3 pb-2 pt-1 shrink-0">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search roles..."
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-text placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Role list — only scrollable element */}
          <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain px-1 pb-3 lg:max-h-[260px]">
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
  const [customRoleDescription, setCustomRoleDescription] = useState("");

  // Stage 2 fields
  const [tagline, setTagline] = useState(existingCandidate?.tagline || "");
  const [yearsExperience, setYearsExperience] = useState(existingCandidate?.years_experience || "");
  const [bio, setBio] = useState(existingCandidate?.bio || "");
  const [skills, setSkills] = useState<string[]>(existingCandidate?.skills || []);
  const [tools, setTools] = useState<string[]>(existingCandidate?.tools || []);
  const [usExperience, setUsExperience] = useState(existingCandidate?.us_client_experience || "");
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
      setLinkedinUrl(existingCandidate.linkedin_url || "");
      setHourlyRate(existingCandidate.hourly_rate || 0);
      setAvailability(existingCandidate.availability_status || "available_now");
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

      // Queue AI screening
      supabase.from("screening_queue").insert({
        candidate_id: newCandidate.id,
        status: "pending",
      }).then(() => {});

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

    if (!tagline.trim()) { setError("Please add a professional tagline"); return; }
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
      tagline: tagline.trim(),
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
            <SearchableRoleSelect value={roleCategory} onChange={(v) => { setRoleCategory(v); if (v !== "Other") setCustomRoleDescription(""); }} />
          </div>

          {roleCategory === "Other" && (
            <div>
              <label className="block text-sm font-medium text-text">Describe Your Role <span className="text-red-500">*</span></label>
              <input
                required
                maxLength={100}
                value={customRoleDescription}
                onChange={(e) => setCustomRoleDescription(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                placeholder="e.g. Grant Writer, Podcast Editor"
              />
              <p className="mt-1 text-xs text-gray-400">{customRoleDescription.length}/100</p>
            </div>
          )}

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
            <label className="block text-sm font-medium text-text mb-1">Key Skills</label>
            <TagInput tags={skills} setTags={setSkills} max={10} placeholder="Type a skill and press Enter" suggestions={SKILLS_BY_ROLE[roleCategory] ?? []} />
          </div>

          <div>
            <label className="block text-sm font-medium text-text mb-1">Tools & Software You Use</label>
            <TagInput tags={tools} setTags={setTools} max={8} placeholder="Type and press Enter" suggestions={TOOLS_BY_ROLE[roleCategory] ?? []} />
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
                <select value={usExperience} onChange={(e) => setUsExperience(e.target.value)} className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary">
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
                <select value={usExperience} onChange={(e) => setUsExperience(e.target.value)} className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary">
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
