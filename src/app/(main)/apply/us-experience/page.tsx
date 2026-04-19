"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const DURATION_OPTIONS = [
  { value: "less_than_6_months", label: "Less than 6 months" },
  { value: "6_months_to_1_year", label: "6 months to 1 year" },
  { value: "1_to_2_years", label: "1 to 2 years" },
  { value: "2_to_5_years", label: "2 to 5 years" },
  { value: "5_plus_years", label: "5+ years" },
];

const NO_OPTIONS = [
  { value: "international_only", label: "I've worked with international clients (non-US)" },
  { value: "none", label: "This would be my first international client" },
];

const DURATION_VALUES = DURATION_OPTIONS.map((o) => o.value);
const NO_VALUES = NO_OPTIONS.map((o) => o.value);

export default function UsExperienceGatePage() {
  const router = useRouter();
  const [yesNo, setYesNo] = useState<string>("");
  const [value, setValue] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  function handleYesNo(v: string) {
    setYesNo(v);
    if ((v === "yes" && !DURATION_VALUES.includes(value)) || (v === "no" && !NO_VALUES.includes(value))) {
      setValue("");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!yesNo) {
      setError("Please answer the question.");
      return;
    }
    if (!value) {
      setError(yesNo === "yes" ? "Please select how long you've worked with US clients." : "Please select an option.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("Not authenticated.");
      setLoading(false);
      return;
    }

    const { error: updateErr } = await supabase
      .from("candidates")
      .update({ us_client_experience: value })
      .eq("user_id", user.id);

    if (updateErr) {
      setError("Failed to save: " + updateErr.message);
      setLoading(false);
      return;
    }

    router.push("/candidate/dashboard");
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-text">One quick question before you continue</h1>
        <p className="mt-2 text-sm text-text/60">
          We updated how we ask about US client experience. Please answer to continue.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-text mb-2">
              Do you have US client experience? <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ].map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-3 cursor-pointer hover:border-primary/30 transition-colors"
                >
                  <input
                    type="radio"
                    name="usExpYesNo"
                    value={opt.value}
                    checked={yesNo === opt.value}
                    onChange={(e) => handleYesNo(e.target.value)}
                    className="text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-text">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {yesNo === "yes" && (
            <div>
              <label className="block text-xs font-medium text-text/60 mb-1.5">
                How long have you worked with US clients?
              </label>
              <select
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Select duration...</option>
                {DURATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {yesNo === "no" && (
            <div>
              <label className="block text-xs font-medium text-text/60 mb-1.5">Tell us a bit more</label>
              <select
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Select an option...</option>
                {NO_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? "Saving..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
