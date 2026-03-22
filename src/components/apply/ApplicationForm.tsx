"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CandidateData } from "@/app/(main)/apply/page";

const COUNTRIES = [
  "Philippines",
  "Lebanon",
  "Egypt",
  "Yemen",
  "Brazil",
  "Other",
];

const ROLE_CATEGORIES = [
  "Admin",
  "Bookkeeping/AP",
  "Paralegal",
  "VA",
  "Scheduling",
  "Customer Support",
];

const EXPERIENCE_OPTIONS = ["0-1", "1-3", "3-5", "5-10", "10+"];

const US_EXPERIENCE_OPTIONS = [
  { value: "full_time", label: "Yes, full time" },
  { value: "part_time_contract", label: "Yes, part time or contract" },
  {
    value: "international_only",
    label: "No, but I have worked with other international clients",
  },
  { value: "none", label: "No, this would be my first international role" },
];

interface Props {
  onComplete: (data: CandidateData) => void;
}

export default function ApplicationForm({ onComplete }: Props) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("");
  const [roleCategory, setRoleCategory] = useState("");
  const [yearsExperience, setYearsExperience] = useState("");
  const [monthlyRate, setMonthlyRate] = useState("");
  const [timeZone, setTimeZone] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [bio, setBio] = useState("");
  const [usExperience, setUsExperience] = useState("");
  const [usDescription, setUsDescription] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Auto-detect timezone
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTimeZone(tz);

    // Pre-fill email from auth
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setEmail(user.email || "");
        setFullName(user.user_metadata?.full_name || "");
      }
    });
  }, []);

  const showUsDescription =
    usExperience === "full_time" || usExperience === "part_time_contract";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Not authenticated");
      setLoading(false);
      return;
    }

    // Ensure profile row exists (trigger may have failed silently)
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .single();

    if (!existingProfile) {
      // Profile missing — create it via API to bypass RLS
      const profileRes = await fetch("/api/ensure-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          email: user.email,
          role: "candidate",
          fullName,
        }),
      });
      if (!profileRes.ok) {
        setError("Failed to initialize profile. Please try again.");
        setLoading(false);
        return;
      }
    }

    const candidateRecord = {
      user_id: user.id,
      full_name: fullName,
      email,
      country,
      role_category: roleCategory,
      years_experience: yearsExperience,
      monthly_rate: parseInt(monthlyRate),
      time_zone: timeZone,
      linkedin_url: linkedinUrl || null,
      bio: bio || null,
      us_client_experience: usExperience,
      us_client_description: showUsDescription ? usDescription : null,
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

    // Fire-and-forget AI screening — never blocks the candidate
    fetch("/api/screening", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: data.id }),
    }).catch(() => {
      // Silently ignore — screening failure never blocks the candidate
    });

    onComplete(data as CandidateData);
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-text">Candidate Application</h1>
      <p className="mt-2 text-sm text-text/60">
        Complete this form to begin the English assessment. All fields are
        required unless marked optional.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-text">
              Full Name
            </label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text">Country</label>
          <input
            type="text"
            required
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="Type your country"
            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            list="country-list"
          />
          <datalist id="country-list">
            {COUNTRIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-text">
              Role Category
            </label>
            <select
              required
              value={roleCategory}
              onChange={(e) => setRoleCategory(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select a role</option>
              {ROLE_CATEGORIES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text">
              Years of Experience
            </label>
            <select
              required
              value={yearsExperience}
              onChange={(e) => setYearsExperience(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select experience</option>
              {EXPERIENCE_OPTIONS.map((e) => (
                <option key={e} value={e}>
                  {e} years
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-text">
              Monthly Rate Expectation (USD)
            </label>
            <input
              type="number"
              required
              min="1"
              value={monthlyRate}
              onChange={(e) => setMonthlyRate(e.target.value)}
              placeholder="e.g. 800"
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text">
              Time Zone
            </label>
            <input
              type="text"
              required
              value={timeZone}
              onChange={(e) => setTimeZone(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text">
            LinkedIn URL <span className="text-text/40">(optional)</span>
          </label>
          <input
            type="url"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://linkedin.com/in/yourprofile"
            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text">
            Short Bio
          </label>
          <textarea
            required
            maxLength={300}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            placeholder="Briefly describe your background and skills (max 300 characters)"
            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
          <p className="mt-1 text-xs text-text/40">{bio.length}/300</p>
        </div>

        {/* US Client Experience Section */}
        <div className="border-t border-gray-200 pt-6">
          <h2 className="text-lg font-semibold text-text">
            US Client Experience
          </h2>

          <div className="mt-4">
            <label className="block text-sm font-medium text-text">
              Have you previously worked with US-based clients or employers?
            </label>
            <div className="mt-2 space-y-2">
              {US_EXPERIENCE_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="us_experience"
                    value={opt.value}
                    required
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
                Briefly describe the type of work you did and the industry your
                US client was in.
              </label>
              <textarea
                required
                maxLength={200}
                value={usDescription}
                onChange={(e) => setUsDescription(e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
              <p className="mt-1 text-xs text-text/40">
                {usDescription.length}/200
              </p>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {loading ? "Submitting..." : "Continue to English Assessment"}
        </button>
      </form>
    </div>
  );
}
