/**
 * The ONE mapping between the coarse browse vocabulary (pills, AI parser,
 * nav links) and the fine-grained role_category values candidates actually
 * store (picked in ApplicationForm). The interface audit found these two
 * vocabularies had never met: the "VA" pill matched zero rows while six
 * approved Virtual Assistants existed.
 *
 * Pill roles are passed to the RPC as ILIKE patterns — bare values mean
 * case-insensitive exact match; anything unknown falls back to a substring
 * pattern so direct links like /browse?role=Virtual+Assistant (hero chips)
 * and partial values keep working.
 */

export const BROWSE_PILLS: { label: string; roles: string[] }[] = [
  { label: "Paralegal", roles: ["Paralegal"] },
  {
    label: "Legal Assistant",
    roles: ["Legal Assistant", "Legal Secretary", "Litigation Support", "Contract Reviewer"],
  },
  {
    label: "Bookkeeping/AP",
    roles: [
      "Bookkeeper",
      "Accounts Payable Specialist",
      "Accounts Receivable Specialist",
      "Payroll Specialist",
      "Tax Preparer",
      "Financial Analyst",
    ],
  },
  {
    label: "Admin",
    roles: [
      "Administrative Assistant",
      "Executive Assistant",
      "Office Manager",
      "Data Entry Specialist",
      "Transcriptionist",
    ],
  },
  { label: "VA", roles: ["Virtual Assistant"] },
  { label: "Cold Caller", roles: ["Cold Caller", "Appointment Setter"] },
  {
    label: "Sales",
    roles: ["Sales Representative", "Account Manager", "Lead Generation Specialist"],
  },
  { label: "SDR", roles: ["Sales Development Representative (SDR)"] },
  { label: "SEO", roles: ["SEO Specialist"] },
  {
    label: "Marketing",
    roles: [
      "Social Media Manager",
      "Content Writer",
      "Paid Ads Specialist",
      "Email Marketing Specialist",
      "CRM Manager",
    ],
  },
  { label: "Scheduling", roles: ["Scheduling Coordinator"] },
  { label: "Customer Support", roles: ["Customer Support Representative"] },
  {
    label: "Medical",
    roles: [
      "Medical Billing Specialist",
      "Medical Administrative Assistant",
      "Insurance Verification Specialist",
      "Dental Office Administrator",
    ],
  },
  {
    label: "E-Commerce",
    roles: ["E-Commerce Manager", "Shopify Manager", "Amazon Store Manager"],
  },
];

/** The role patterns to hand the RPC for a ?role= value (pill label OR raw role). */
export function rolePatternsFor(roleParam: string): string[] {
  const pill = BROWSE_PILLS.find((p) => p.label.toLowerCase() === roleParam.toLowerCase());
  if (pill) return pill.roles;
  return [`%${roleParam}%`];
}
