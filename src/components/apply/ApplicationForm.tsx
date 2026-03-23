"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CandidateData } from "@/app/(main)/apply/page";

// ─── Countries by Region ───
const COUNTRY_GROUPS = [
  {
    label: "Middle East",
    countries: ["Bahrain", "Iraq", "Jordan", "Kuwait", "Lebanon", "Oman", "Palestine", "Qatar", "Saudi Arabia", "Syria", "United Arab Emirates", "Yemen"],
  },
  {
    label: "South Asia",
    countries: ["Bangladesh", "India", "Nepal", "Pakistan", "Sri Lanka"],
  },
  {
    label: "North Africa",
    countries: ["Algeria", "Egypt", "Libya", "Morocco", "Tunisia"],
  },
  {
    label: "South America",
    countries: ["Argentina", "Bolivia", "Brazil", "Chile", "Colombia", "Ecuador", "Paraguay", "Peru", "Uruguay", "Venezuela"],
  },
  {
    label: "Other",
    countries: ["Ghana", "Indonesia", "Kenya", "Nigeria", "Philippines", "South Africa", "Turkey", "Other"],
  },
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

// ─── Role group detection ───
function getRoleGroup(role: string): string {
  const legalRoles = ["Paralegal", "Legal Assistant", "Legal Secretary", "Litigation Support", "Contract Reviewer"];
  const accountingRoles = ["Bookkeeper", "Accounts Payable Specialist", "Accounts Receivable Specialist", "Payroll Specialist", "Tax Preparer", "Financial Analyst"];
  const adminRoles = ["Administrative Assistant", "Executive Assistant", "Virtual Assistant", "Office Manager", "Data Entry Specialist"];
  const medicalRoles = ["Medical Billing Specialist", "Medical Administrative Assistant", "Insurance Verification Specialist", "Dental Office Administrator"];
  const realEstateRoles = ["Real Estate Assistant", "Transaction Coordinator"];
  const schedulingRoles = ["Scheduling Coordinator"];

  if (legalRoles.includes(role)) return "legal";
  if (accountingRoles.includes(role)) return "accounting";
  if (adminRoles.includes(role)) return "admin";
  if (medicalRoles.includes(role)) return "medical";
  if (realEstateRoles.includes(role)) return "realestate";
  if (schedulingRoles.includes(role)) return "scheduling";
  return "other";
}

// ─── Suggested Skills by Role Group ───
const SKILLS_BY_GROUP: Record<string, string[]> = {
  legal: ["Legal research", "Contract drafting", "Case management", "Document review", "Client communication", "Court filing", "Deposition scheduling", "Legal writing", "Westlaw", "Clio"],
  accounting: ["Bookkeeping", "Accounts payable", "Accounts receivable", "Payroll processing", "Bank reconciliation", "QuickBooks", "Xero", "Tax preparation", "Financial reporting", "Excel"],
  admin: ["Calendar management", "Email management", "Data entry", "Travel coordination", "Report preparation", "CRM management", "Google Workspace", "Microsoft 365", "Zoom", "Slack"],
  medical: ["Medical billing", "Insurance verification", "ICD-10 coding", "CPT coding", "EHR management", "Patient scheduling", "HIPAA compliance", "Medical terminology", "Claim submission", "Denial management"],
  realestate: ["Transaction coordination", "MLS management", "Contract review", "Client follow-up", "Listing coordination", "DocuSign", "Dotloop", "Showing scheduling", "CRM management", "Market research"],
  scheduling: ["Calendar management", "Appointment scheduling", "Client coordination", "Time zone management", "CRM management", "Google Calendar", "Outlook", "Calendly", "Zoom", "Slack"],
  other: ["Project management", "Research", "Data analysis", "Report writing", "Customer service", "Social media", "Email marketing", "Microsoft Office", "Google Workspace", "Asana"],
};

// ─── Suggested Tools by Role Group ───
const TOOLS_BY_GROUP: Record<string, string[]> = {
  legal: ["Clio", "MyCase", "PracticePanther", "LexisNexis", "Westlaw", "Microsoft Word", "Adobe Acrobat", "Outlook", "Dropbox", "Zoom"],
  accounting: ["QuickBooks", "Xero", "FreshBooks", "Bill.com", "Gusto", "Excel", "NetSuite", "Sage", "Expensify", "Stripe"],
  admin: ["Google Workspace", "Microsoft 365", "Asana", "Trello", "Notion", "Slack", "Zoom", "Calendly", "HubSpot", "Salesforce"],
  medical: ["Epic", "Kareo", "AdvancedMD", "Athenahealth", "DrChrono", "Practice Fusion", "Medisoft", "Office Ally", "Availity", "Change Healthcare"],
  realestate: ["Dotloop", "DocuSign", "Zillow", "MLS", "Follow Up Boss", "Buildium", "AppFolio", "ShowingTime", "Skyslope", "Brokermint"],
  scheduling: ["Calendly", "Acuity", "Google Calendar", "Outlook", "Mindbody", "Jane App", "OpenDental", "Dentrix", "SimplePractice", "Square Appointments"],
  other: ["Microsoft Office", "Google Workspace", "Zoom", "Slack", "Asana", "Trello", "Notion", "HubSpot", "Salesforce", "Zapier"],
};

const EXPERIENCE_OPTIONS = ["0-1", "1-3", "3-5", "5-10", "10+"];

const US_EXPERIENCE_OPTIONS = [
  { value: "full_time", label: "Yes, full time" },
  { value: "part_time_contract", label: "Yes, part time or contract" },
  { value: "international_only", label: "No, but I have worked with other international clients" },
  { value: "none", label: "No, this would be my first international role" },
];

interface Props {
  onComplete: (data: CandidateData) => void;
}

// ─── Tag Input Component ───
function TagInput({
  tags, setTags, max, placeholder, suggestions,
}: {
  tags: string[];
  setTags: (tags: string[]) => void;
  max: number;
  placeholder: string;
  suggestions: string[];
}) {
  const [input, setInput] = useState("");

  function addTag(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed || tags.includes(trimmed) || tags.length >= max) return;
    setTags([...tags, trimmed]);
    setInput("");
  }

  function removeTag(tag: string) {
    setTags(tags.filter((t) => t !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    }
    if (e.key === "Backspace" && input === "" && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  }

  const unusedSuggestions = suggestions.filter((s) => !tags.includes(s));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-xs font-medium text-primary">
            {tag}
            <button type="button" onClick={() => removeTag(tag)} className="ml-0.5 text-primary/60 hover:text-primary">
              &times;
            </button>
          </span>
        ))}
        {tags.length < max && (
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={tags.length === 0 ? placeholder : ""}
            className="flex-1 min-w-[120px] border-0 bg-transparent text-sm text-text outline-none placeholder-text/40"
          />
        )}
      </div>
      <p className="mt-1 text-xs text-text/40">{tags.length}/{max} — press Enter or comma to add</p>
      {unusedSuggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {unusedSuggestions.slice(0, 10).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addTag(s)}
              className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs text-text/60 hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ApplicationForm({ onComplete }: Props) {
  // College degree gate
  const [hasDegree, setHasDegree] = useState<boolean | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("");
  const [roleCategory, setRoleCategory] = useState("");
  const [customRoleDescription, setCustomRoleDescription] = useState("");
  const [yearsExperience, setYearsExperience] = useState("");
  const [monthlyRate, setMonthlyRate] = useState("");
  const [timeZone, setTimeZone] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [bio, setBio] = useState("");
  const [usExperience, setUsExperience] = useState("");
  const [usDescription, setUsDescription] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const roleGroup = getRoleGroup(roleCategory);
  const suggestedSkills = SKILLS_BY_GROUP[roleGroup] || SKILLS_BY_GROUP.other;
  const suggestedTools = TOOLS_BY_GROUP[roleGroup] || TOOLS_BY_GROUP.other;

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTimeZone(tz);

    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setEmail(user.email || "");
        setFullName(user.user_metadata?.full_name || "");
      }
    });
  }, []);

  const showUsDescription = usExperience === "full_time" || usExperience === "part_time_contract";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (roleCategory === "Other" && !customRoleDescription.trim()) {
      setError("Please describe your role");
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setError("Not authenticated");
      setLoading(false);
      return;
    }

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .single();

    if (!existingProfile) {
      const profileRes = await fetch("/api/ensure-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, email: user.email, role: "candidate", fullName }),
      });
      if (!profileRes.ok) {
        setError("Failed to initialize profile. Please try again.");
        setLoading(false);
        return;
      }
    }

    const finalRole = roleCategory === "Other" ? customRoleDescription.trim() : roleCategory;

    const candidateRecord = {
      user_id: user.id,
      full_name: fullName,
      email,
      country,
      role_category: finalRole,
      years_experience: yearsExperience,
      monthly_rate: parseInt(monthlyRate),
      time_zone: timeZone,
      linkedin_url: linkedinUrl || null,
      bio: bio || null,
      us_client_experience: usExperience,
      us_client_description: showUsDescription ? usDescription : null,
      has_college_degree: hasDegree,
      custom_role_description: roleCategory === "Other" ? customRoleDescription.trim() : null,
      skills: skills,
      tools: tools,
    };

    const { data, error: insertError } = await supabase
      .from("candidates")
      .insert(candidateRecord)
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    fetch("/api/screening", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: data.id }),
    }).catch(() => {});

    onComplete(data as CandidateData);
  }

  // ─── DEGREE GATE ───
  if (hasDegree === null) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <h1 className="text-2xl font-bold text-text">Before We Begin</h1>
        <p className="mt-3 text-text/60">
          StaffVA connects pre-vetted professionals with U.S. businesses. To ensure quality
          standards, we require all candidates to hold at least a college-level degree or equivalent
          professional certification.
        </p>
        <div className="mt-8 space-y-4">
          <p className="text-sm font-medium text-text">
            Do you have a college degree or equivalent professional certification?
          </p>
          <div className="flex justify-center gap-4">
            <button
              onClick={() => { setHasDegree(true); setShowForm(true); }}
              className="rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
            >
              Yes, I do
            </button>
            <button
              onClick={() => setHasDegree(false)}
              className="rounded-lg border border-gray-300 px-8 py-3 text-sm font-medium text-text hover:bg-gray-50 transition-colors"
            >
              No, I don&apos;t
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (hasDegree === false) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
          <svg className="h-8 w-8 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-text">Thank You for Your Interest</h1>
        <p className="mt-3 text-text/60">
          At this time, StaffVA requires all candidates to hold at least a college-level degree or
          equivalent professional certification. This helps us maintain the quality standards our
          clients expect.
        </p>
        <p className="mt-4 text-text/60">
          We encourage you to continue building your skills and credentials. You are welcome to
          reapply in the future once you have obtained a qualifying credential.
        </p>
        <p className="mt-6 text-sm text-text/40">
          If you believe this is an error, please contact us at support@staffva.com.
        </p>
      </div>
    );
  }

  // ─── MAIN FORM ───
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-text">Candidate Application</h1>
      <p className="mt-2 text-sm text-text/60">
        Complete this form to begin the English assessment. All fields are required unless marked optional.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        {/* Name and Email */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-text">Full Name</label>
            <input
              type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text">Email</label>
            <input
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Country — grouped dropdown */}
        <div>
          <label className="block text-sm font-medium text-text">Country</label>
          <select
            required value={country} onChange={(e) => setCountry(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Select your country</option>
            {COUNTRY_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.countries.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Role Category — grouped dropdown */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-text">Role Category</label>
            <select
              required value={roleCategory} onChange={(e) => { setRoleCategory(e.target.value); setSkills([]); setTools([]); }}
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select a role</option>
              {ROLE_CATEGORIES.map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.roles.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {roleCategory === "Other" && (
              <input
                type="text" required maxLength={80} value={customRoleDescription}
                onChange={(e) => setCustomRoleDescription(e.target.value)}
                placeholder="Describe your role (max 80 characters)"
                className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-text">Years of Experience</label>
            <select
              required value={yearsExperience} onChange={(e) => setYearsExperience(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select experience</option>
              {EXPERIENCE_OPTIONS.map((e) => (
                <option key={e} value={e}>{e} years</option>
              ))}
            </select>
          </div>
        </div>

        {/* Key Skills — tag input */}
        {roleCategory && (
          <div>
            <label className="block text-sm font-medium text-text mb-1">
              Key Skills <span className="text-text/40 text-xs">(up to 10)</span>
            </label>
            <TagInput
              tags={skills}
              setTags={setSkills}
              max={10}
              placeholder="e.g. Contract drafting, QuickBooks, Client communication"
              suggestions={suggestedSkills}
            />
          </div>
        )}

        {/* Tools & Software — tag input */}
        {roleCategory && (
          <div>
            <label className="block text-sm font-medium text-text mb-1">
              Tools & Software <span className="text-text/40 text-xs">(up to 8)</span>
            </label>
            <TagInput
              tags={tools}
              setTags={setTools}
              max={8}
              placeholder="e.g. Clio, QuickBooks, Microsoft 365"
              suggestions={suggestedTools}
            />
          </div>
        )}

        {/* Rate and Timezone */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-text">Monthly Rate Expectation (USD)</label>
            <input
              type="number" required min="1" value={monthlyRate} onChange={(e) => setMonthlyRate(e.target.value)}
              placeholder="e.g. 800"
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text">Time Zone</label>
            <input
              type="text" required value={timeZone} onChange={(e) => setTimeZone(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* LinkedIn */}
        <div>
          <label className="block text-sm font-medium text-text">
            LinkedIn URL <span className="text-text/40">(optional)</span>
          </label>
          <input
            type="url" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://linkedin.com/in/yourprofile"
            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Bio */}
        <div>
          <label className="block text-sm font-medium text-text">Short Bio</label>
          <textarea
            required maxLength={300} value={bio} onChange={(e) => setBio(e.target.value)} rows={3}
            placeholder="Briefly describe your background and skills (max 300 characters)"
            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
          <p className="mt-1 text-xs text-text/40">{bio.length}/300</p>
        </div>

        {/* US Client Experience */}
        <div className="border-t border-gray-200 pt-6">
          <h2 className="text-lg font-semibold text-text">US Client Experience</h2>
          <div className="mt-4">
            <label className="block text-sm font-medium text-text">
              Have you previously worked with US-based clients or employers?
            </label>
            <div className="mt-2 space-y-2">
              {US_EXPERIENCE_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-3">
                  <input
                    type="radio" name="us_experience" value={opt.value} required
                    checked={usExperience === opt.value}
                    onChange={(e) => setUsExperience(e.target.value)}
                    className="h-4 w-4 border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-text">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {showUsDescription && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-text">
                Briefly describe the type of work you did and the industry your US client was in.
              </label>
              <textarea
                required maxLength={200} value={usDescription} onChange={(e) => setUsDescription(e.target.value)} rows={2}
                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
              <p className="mt-1 text-xs text-text/40">{usDescription.length}/200</p>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit" disabled={loading}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {loading ? "Submitting..." : "Continue to English Assessment"}
        </button>
      </form>
    </div>
  );
}
