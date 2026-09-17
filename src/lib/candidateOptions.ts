/**
 * Shared option lists for candidate editable fields.
 * Duplicated from ApplicationForm.tsx rather than importing, to avoid
 * pulling a multi-thousand-line form component into smaller edit modals.
 * If ApplicationForm's list evolves, update this one to match.
 */

export const YEARS_EXPERIENCE_OPTIONS = ["0-1", "1-3", "3-5", "5-10", "10+"] as const;

export const ROLE_CATEGORY_GROUPS: Array<{ group: string; roles: string[] }> = [
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

/** Single flat list of role names for validation. */
export const ALL_ROLE_NAMES: string[] = ROLE_CATEGORY_GROUPS.flatMap((g) => g.roles);

/**
 * Which family a role belongs to — "Paralegal" → "Legal".
 *
 * AI screening needs this to judge "is this experience related to the role?"
 * against the right family. Without it the only frame of reference was the
 * hard-coded one in the prompt, which named Legal and Accounting and so read
 * every one of the other eleven groups as unrelated work.
 */
export function groupForRole(role: string | null | undefined): string | null {
  if (!role) return null;
  return ROLE_CATEGORY_GROUPS.find((g) => g.roles.includes(role))?.group ?? null;
}

export type WorkExperienceEntry = {
  company_name?: string;
  role_title: string;
  industry: string;
  duration: string;
  description: string;
  start_date?: string;
  end_date?: string;
};
