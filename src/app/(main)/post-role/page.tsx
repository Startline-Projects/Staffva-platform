"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ROLE_CATEGORIES = [
  { group: "Legal", roles: ["Paralegal", "Legal Assistant", "Legal Secretary", "Litigation Support", "Contract Reviewer"] },
  { group: "Accounting & Finance", roles: ["Bookkeeper", "Accounts Payable Specialist", "Accounts Receivable Specialist", "Payroll Specialist", "Tax Preparer", "Financial Analyst"] },
  { group: "Administration", roles: ["Administrative Assistant", "Executive Assistant", "Virtual Assistant", "Office Manager", "Data Entry Specialist"] },
  { group: "Scheduling & Support", roles: ["Scheduling Coordinator", "Customer Support Representative"] },
  { group: "Medical", roles: ["Medical Billing Specialist", "Medical Administrative Assistant", "Insurance Verification Specialist", "Dental Office Administrator"] },
  { group: "Real Estate", roles: ["Real Estate Assistant", "Transaction Coordinator"] },
  { group: "HR & Recruiting", roles: ["HR Assistant", "Recruitment Coordinator"] },
  { group: "Marketing & Creative", roles: ["Social Media Manager", "Content Writer", "Graphic Designer", "Video Editor"] },
  { group: "Operations", roles: ["Project Manager", "Operations Assistant", "E-commerce Assistant", "Amazon Store Manager", "Shopify Assistant"] },
  { group: "Other", roles: ["Other"] },
];

const HOURS_OPTIONS = [
  { label: "Full Time", sublabel: "40 hrs/week", value: "Full Time (40 hrs)" },
  { label: "Part Time", sublabel: "20 hrs/week", value: "Part Time (20 hrs)" },
  { label: "Flexible", sublabel: "10–15 hrs/week", value: "Flexible (10-15 hrs)" },
  { label: "Project Based", sublabel: "As needed", value: "Project Based" },
];

const BUDGET_OPTIONS = [
  { label: "Under $800", sublabel: "/hrnth", value: "Under $800" },
  { label: "$800 – $1,200", sublabel: "/hrnth", value: "$800 - $1,200" },
  { label: "$1,200 – $2,000", sublabel: "/hrnth", value: "$1,200 - $2,000" },
  { label: "Over $2,000", sublabel: "/hrnth", value: "Over $2,000" },
];

const START_OPTIONS = [
  { label: "Immediately", sublabel: "Ready to start now", value: "Immediately" },
  { label: "Within 2 weeks", sublabel: "Starting soon", value: "Within 2 weeks" },
  { label: "Within a month", sublabel: "Flexible timeline", value: "Within a month" },
];

export default function PostRolePage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [roleCategory, setRoleCategory] = useState("");
  const [customRole, setCustomRole] = useState("");
  const [hoursPerWeek, setHoursPerWeek] = useState("");
  const [budgetRange, setBudgetRange] = useState("");
  const [startDate, setStartDate] = useState("");
  const [description, setDescription] = useState("");

  async function handleSubmit() {
    if (!roleCategory || !hoursPerWeek || !budgetRange || !startDate) {
      setError("Please complete all required fields.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/login"); return; }

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ role_category: roleCategory, custom_role_description: roleCategory === "Other" ? customRole : null, hours_per_week: hoursPerWeek, budget_range: budgetRange, start_date: startDate, description }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Something went wrong"); setLoading(false); return; }
      sessionStorage.setItem("job_post_result", JSON.stringify(data));
      router.push(`/post-role/shortlist?id=${data.jobPost.id}`);
    } catch {
      setError("Failed to submit. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1C1B1A]">Post a Role</h1>
        <p className="mt-1 text-sm text-gray-500">Tell us what you need. We&apos;ll match you with the best candidates instantly.</p>
      </div>
      <div className="mb-8 flex gap-1">
        {[1, 2, 3, 4].map((s) => (<div key={s} className={`h-1 flex-1 rounded-full ${s <= step ? "bg-[#FE6E3E]" : "bg-gray-200"}`} />))}
      </div>
      {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      {step === 1 && (
        <div>
          <h2 className="text-lg font-semibold text-[#1C1B1A]">What role do you need?</h2>
          <p className="mt-1 mb-4 text-sm text-gray-500">Select the role that best matches your needs.</p>
          <select value={roleCategory} onChange={(e) => setRoleCategory(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-[#1C1B1A] focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E]">
            <option value="">Select a role...</option>
            {ROLE_CATEGORIES.map((group) => (<optgroup key={group.group} label={group.group}>{group.roles.map((role) => (<option key={role} value={role}>{role}</option>))}</optgroup>))}
          </select>
          {roleCategory === "Other" && (
            <input type="text" value={customRole} onChange={(e) => setCustomRole(e.target.value)} placeholder="Describe the role you need" maxLength={80} className="mt-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-[#1C1B1A] focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E]" />
          )}
          <button onClick={() => { if (!roleCategory) { setError("Please select a role."); return; } setError(""); setStep(2); }} className="mt-6 w-full rounded-lg bg-[#FE6E3E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors">Continue</button>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 className="text-lg font-semibold text-[#1C1B1A]">How many hours per week?</h2>
          <p className="mt-1 mb-4 text-sm text-gray-500">Select the commitment level you need.</p>
          <div className="grid grid-cols-2 gap-3">
            {HOURS_OPTIONS.map((opt) => (
              <button key={opt.value} onClick={() => setHoursPerWeek(opt.value)} className={`rounded-lg border-2 p-4 text-left transition-all ${hoursPerWeek === opt.value ? "border-[#FE6E3E] bg-orange-50" : "border-gray-200 bg-white hover:border-gray-300"}`}>
                <p className="text-sm font-semibold text-[#1C1B1A]">{opt.label}</p>
                <p className="mt-0.5 text-xs text-gray-500">{opt.sublabel}</p>
              </button>
            ))}
          </div>
          <div className="mt-6 flex gap-3">
            <button onClick={() => setStep(1)} className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-[#1C1B1A] hover:bg-gray-50">Back</button>
            <button onClick={() => { if (!hoursPerWeek) { setError("Please select hours per week."); return; } setError(""); setStep(3); }} className="flex-1 rounded-lg bg-[#FE6E3E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors">Continue</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <h2 className="text-lg font-semibold text-[#1C1B1A]">What&apos;s your monthly budget?</h2>
          <p className="mt-1 mb-4 text-sm text-gray-500">Select the range that fits your hiring budget.</p>
          <div className="grid grid-cols-2 gap-3">
            {BUDGET_OPTIONS.map((opt) => (
              <button key={opt.value} onClick={() => setBudgetRange(opt.value)} className={`rounded-lg border-2 p-4 text-left transition-all ${budgetRange === opt.value ? "border-[#FE6E3E] bg-orange-50" : "border-gray-200 bg-white hover:border-gray-300"}`}>
                <p className="text-sm font-semibold text-[#1C1B1A]">{opt.label}</p>
                <p className="mt-0.5 text-xs text-gray-500">{opt.sublabel}</p>
              </button>
            ))}
          </div>
          <h2 className="mt-8 text-lg font-semibold text-[#1C1B1A]">When do you need them to start?</h2>
          <p className="mt-1 mb-4 text-sm text-gray-500">Select your preferred start timeline.</p>
          <div className="grid grid-cols-3 gap-3">
            {START_OPTIONS.map((opt) => (
              <button key={opt.value} onClick={() => setStartDate(opt.value)} className={`rounded-lg border-2 p-4 text-left transition-all ${startDate === opt.value ? "border-[#FE6E3E] bg-orange-50" : "border-gray-200 bg-white hover:border-gray-300"}`}>
                <p className="text-sm font-semibold text-[#1C1B1A]">{opt.label}</p>
                <p className="mt-0.5 text-xs text-gray-500">{opt.sublabel}</p>
              </button>
            ))}
          </div>
          <div className="mt-6 flex gap-3">
            <button onClick={() => setStep(2)} className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-[#1C1B1A] hover:bg-gray-50">Back</button>
            <button onClick={() => { if (!budgetRange || !startDate) { setError("Please select budget and start date."); return; } setError(""); setStep(4); }} className="flex-1 rounded-lg bg-[#FE6E3E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors">Continue</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div>
          <h2 className="text-lg font-semibold text-[#1C1B1A]">Describe what you need</h2>
          <p className="mt-1 mb-4 text-sm text-gray-500">Optional — give us more details to improve your matches.</p>
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 mb-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Your requirements</p>
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-orange-100 px-3 py-1 text-[#FE6E3E] font-medium">{roleCategory}</span>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-[#1C1B1A]">{hoursPerWeek}</span>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-[#1C1B1A]">{budgetRange}</span>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-[#1C1B1A]">Start: {startDate}</span>
            </div>
          </div>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={4} placeholder="Describe the specific tasks, experience level, and any tools or software required..." className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-[#1C1B1A] placeholder-gray-400 focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E] resize-none" />
          <p className="mt-1 text-xs text-gray-400">{description.length}/500</p>
          <div className="mt-6 flex gap-3">
            <button onClick={() => setStep(3)} className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-[#1C1B1A] hover:bg-gray-50">Back</button>
            <button onClick={handleSubmit} disabled={loading} className="flex-1 rounded-lg bg-[#FE6E3E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors disabled:opacity-50">
              {loading ? "Finding matches..." : "Find Matching Candidates"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
