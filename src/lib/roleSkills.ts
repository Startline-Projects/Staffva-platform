/**
 * The role and skill taxonomy — ONE copy.
 *
 * This lived as two byte-identical constants inside ProfileBuilder and
 * ApplicationForm (client components), which meant the server could not see
 * the vocabulary at all. The AI job composer needs it server-side so the tags
 * it generates are the same strings candidates pick during onboarding —
 * matching only works when both sides speak the same words.
 */
export const SKILLS_BY_ROLE: Record<string, string[]> = {
  // ── Legal ──
  Paralegal: [
    "Legal research", "Document drafting", "Case management", "Deposition summaries",
    "Discovery support", "Court filing", "Client communication", "Contract review",
  ],
  "Legal Assistant": [
    "Document preparation", "Legal research", "Calendar management", "Client intake",
    "Filing and docketing", "Correspondence drafting", "Billing support", "Court scheduling",
  ],
  "Legal Secretary": [
    "Document formatting", "Docket management", "Correspondence drafting", "Records management",
    "Client communication", "Billing support", "Transcript preparation", "Court scheduling",
  ],
  "Litigation Support": [
    "Document review", "eDiscovery management", "Trial preparation", "Case chronology",
    "Deposition summaries", "Evidence organization", "Legal research", "Data room management",
  ],
  "Contract Reviewer": [
    "Contract analysis", "Risk identification", "Redlining", "Clause comparison",
    "Legal research", "Summary drafting", "Compliance review", "Document management",
  ],
  // ── Accounting & Finance ──
  "Bookkeeper": [
    "Bank reconciliation", "Accounts payable", "Accounts receivable", "Expense tracking",
    "Financial reporting", "Invoice processing", "Payroll support", "Month-end close",
  ],
  "Accounts Payable Specialist": [
    "Invoice processing", "Vendor management", "Payment scheduling", "Reconciliation",
    "Expense reporting", "Purchase order matching", "Month-end close", "Compliance tracking",
  ],
  "Accounts Receivable Specialist": [
    "Invoice generation", "Collections management", "Payment application", "Reconciliation",
    "Aging report analysis", "Customer billing", "Month-end close", "Dispute resolution",
  ],
  "Payroll Specialist": [
    "Payroll processing", "Tax withholding", "Benefits administration", "Timekeeping",
    "Compliance reporting", "Off-cycle payroll", "Reconciliation", "Employee records",
  ],
  "Tax Preparer": [
    "Tax return preparation", "Client documentation", "Federal and state filings", "Bookkeeping review",
    "Deduction analysis", "E-filing", "Client communication", "IRS correspondence",
  ],
  "Financial Analyst": [
    "Financial modeling", "Budget analysis", "Variance reporting", "Forecasting",
    "KPI tracking", "Data visualization", "P&L analysis", "Investor reporting",
  ],
  // ── Administrative ──
  "Administrative Assistant": [
    "Calendar management", "Email management", "Document preparation", "Travel coordination",
    "Data entry", "Meeting coordination", "Expense reporting", "Stakeholder communication",
  ],
  "Executive Assistant": [
    "Executive calendar management", "Board communications", "Travel planning", "Meeting preparation",
    "Project coordination", "Expense management", "Confidential correspondence", "Stakeholder management",
  ],
  "Virtual Assistant": [
    "Calendar management", "Email management", "Research", "Data entry",
    "Social media scheduling", "Customer service", "Document preparation", "Administrative support",
  ],
  "Office Manager": [
    "Operations coordination", "Vendor management", "Budget tracking", "HR support",
    "Onboarding", "Policy documentation", "Scheduling", "Facilities coordination",
  ],
  "Data Entry Specialist": [
    "Data validation", "Spreadsheet management", "CRM data entry", "Quality checking",
    "Database management", "Report generation", "Error correction", "Record keeping",
  ],
  "Transcriptionist": [
    "Audio transcription", "Verbatim transcription", "Timestamping", "Proofreading",
    "Document formatting", "Medical terminology", "Legal terminology", "Quality assurance",
  ],
  // ── Sales & Outreach ──
  "Cold Caller": [
    "Prospecting", "Script delivery", "Objection handling", "Lead qualification",
    "CRM logging", "Follow-up scheduling", "Pipeline management", "Callback coordination",
  ],
  "Sales Representative": [
    "Lead qualification", "Product presentations", "Proposal writing", "Objection handling",
    "CRM management", "Deal closing", "Pipeline management", "Client follow-up",
  ],
  "Sales Development Representative (SDR)": [
    "Lead prospecting", "Cold outreach", "Email sequences", "Qualifying calls",
    "CRM logging", "Meeting booking", "Account research", "Pipeline building",
  ],
  "Appointment Setter": [
    "Prospect outreach", "Call handling", "Objection handling", "Calendar coordination",
    "CRM logging", "Lead qualification", "Follow-up sequences", "Confirmation calls",
  ],
  "Account Manager": [
    "Client relationship management", "Upselling", "Renewal management", "QBR preparation",
    "Issue resolution", "Contract management", "Performance reporting", "Stakeholder communication",
  ],
  "Lead Generation Specialist": [
    "Prospect research", "List building", "Email outreach", "LinkedIn prospecting",
    "Data enrichment", "CRM management", "Campaign tracking", "Reporting",
  ],
  // ── Marketing & SEO ──
  "Social Media Manager": [
    "Content creation", "Post scheduling", "Community management", "Analytics reporting",
    "Campaign management", "Hashtag research", "Audience engagement", "Trend monitoring",
  ],
  "Content Writer": [
    "Blog writing", "Copywriting", "SEO optimization", "Research",
    "Editing and proofreading", "Content strategy", "Keyword integration", "Content calendar management",
  ],
  "SEO Specialist": [
    "Keyword research", "On-page optimization", "Technical SEO audits", "Link building",
    "Content optimization", "Rank tracking", "Competitor analysis", "Analytics reporting",
  ],
  "Paid Ads Specialist": [
    "Campaign setup", "Ad copywriting", "A/B testing", "Bid management",
    "Audience targeting", "Performance reporting", "Budget optimization", "Conversion tracking",
  ],
  "Email Marketing Specialist": [
    "Campaign creation", "List segmentation", "A/B testing", "Automation setup",
    "Performance reporting", "Copywriting", "List hygiene", "Deliverability optimization",
  ],
  "CRM Manager": [
    "CRM configuration", "Pipeline management", "Automation setup", "Data hygiene",
    "Reporting", "Contact segmentation", "Lead scoring", "Integration management",
  ],
  // ── Scheduling & Support ──
  "Scheduling Coordinator": [
    "Appointment booking", "Calendar management", "Rescheduling", "Client communication",
    "Reminder systems", "Schedule optimization", "Documentation", "Intake coordination",
  ],
  "Customer Support Representative": [
    "Ticket management", "Live chat support", "Email support", "Issue resolution",
    "Escalation handling", "Knowledge base updates", "Customer communication", "Refund processing",
  ],
  // ── Medical ──
  "Medical Billing Specialist": [
    "Claims submission", "Denial management", "Insurance verification", "ICD-10 coding",
    "CPT coding", "EOB reconciliation", "Patient billing", "AR follow-up",
  ],
  "Medical Administrative Assistant": [
    "Patient scheduling", "Insurance verification", "Medical records management", "EMR data entry",
    "Prior authorizations", "Patient communication", "Referral coordination", "Billing support",
  ],
  "Insurance Verification Specialist": [
    "Benefits verification", "Prior authorization", "Eligibility checks", "Coverage documentation",
    "EOB review", "Patient communication", "Denial follow-up", "Payer coordination",
  ],
  "Dental Office Administrator": [
    "Patient scheduling", "Dental billing", "Insurance verification", "Treatment plan coordination",
    "Patient communication", "Records management", "Collections follow-up", "Front desk support",
  ],
  // ── Real Estate ──
  "Real Estate Assistant": [
    "MLS listing management", "Client coordination", "Document preparation", "Showing scheduling",
    "Transaction support", "Social media posting", "Email management", "CRM management",
  ],
  "Transaction Coordinator": [
    "Contract management", "Timeline tracking", "Title coordination", "Escrow management",
    "Document collection", "Closing coordination", "Communication management", "Compliance review",
  ],
  // ── HR & Recruitment ──
  "HR Assistant": [
    "Onboarding coordination", "Employee records", "Benefits administration", "Policy compliance",
    "Job posting", "Interview scheduling", "HR communications", "Offboarding support",
  ],
  "Recruitment Coordinator": [
    "Job posting", "Resume screening", "Interview scheduling", "Candidate communication",
    "ATS management", "Offer coordination", "Background check coordination", "Reporting",
  ],
  // ── Creative & Design ──
  "Graphic Designer": [
    "Brand design", "Social media graphics", "Layout design", "Print design",
    "Illustration", "Photo editing", "Typography", "File preparation for print/web",
  ],
  "Video Editor": [
    "Footage editing", "Color grading", "Audio mixing", "Motion graphics",
    "Subtitling and captions", "Thumbnail design", "Social media video formatting", "Export optimization",
  ],
  // ── Operations & E-Commerce ──
  "Project Manager": [
    "Project planning", "Timeline management", "Stakeholder communication", "Risk management",
    "Budget tracking", "Team coordination", "Status reporting", "Process documentation",
  ],
  "Operations Assistant": [
    "Process documentation", "Vendor coordination", "Data management", "Reporting",
    "Logistics support", "Internal communication", "Budget tracking", "Workflow optimization",
  ],
  "E-Commerce Manager": [
    "Product listing", "Inventory management", "Order fulfillment coordination", "Customer service",
    "Marketing campaigns", "Performance reporting", "Conversion optimization", "Competitor analysis",
  ],
  "Shopify Manager": [
    "Store management", "Product uploads", "Theme customization", "App integration",
    "Order management", "SEO optimization", "Analytics reporting", "Customer service",
  ],
  "Amazon Store Manager": [
    "Listing optimization", "PPC campaign management", "Inventory forecasting", "Review management",
    "Account health monitoring", "Competitor research", "FBA coordination", "Performance reporting",
  ],
};

export const ALL_ROLES = Object.keys(SKILLS_BY_ROLE);
