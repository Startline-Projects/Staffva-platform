"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CandidateData } from "@/app/(main)/apply/page";

const TIER_LABELS: Record<string, string> = {
  exceptional: "Exceptional",
  proficient: "Proficient",
  competent: "Competent",
};

const MAX_PORTFOLIO_ITEMS = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

interface PortfolioEntry {
  file: File;
  description: string;
}

interface Props {
  candidate: CandidateData;
  onComplete: () => void;
}

export default function ProfileBuilder({ candidate, onComplete }: Props) {
  const [availability, setAvailability] = useState("available_now");
  const [availabilityDate, setAvailabilityDate] = useState("");
  const [monthlyRate, setMonthlyRate] = useState(
    candidate.monthly_rate.toString()
  );
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [payoutMethod, setPayoutMethod] = useState("");
  const [portfolioItems, setPortfolioItems] = useState<PortfolioEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function addPortfolioItem(file: File) {
    if (portfolioItems.length >= MAX_PORTFOLIO_ITEMS) return;
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const isImage = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
    const isPdf = ext === "pdf";
    if (!isImage && !isPdf) {
      setError("Portfolio items must be PDF or image files (JPG, PNG, GIF, WebP).");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("Each portfolio file must be under 5MB.");
      return;
    }
    setError("");
    setPortfolioItems((prev) => [...prev, { file, description: "" }]);
  }

  function removePortfolioItem(index: number) {
    setPortfolioItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updatePortfolioDescription(index: number, desc: string) {
    setPortfolioItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, description: desc } : item
      )
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!payoutMethod) {
      setError("Please select a payout method before submitting.");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    // Upload resume
    let resumeUrl = candidate.resume_url;
    if (resumeFile) {
      if (resumeFile.type !== "application/pdf") {
        setError("Only PDF files are accepted for resume.");
        setLoading(false);
        return;
      }
      if (resumeFile.size > MAX_FILE_SIZE) {
        setError("Resume must be under 5MB.");
        setLoading(false);
        return;
      }

      const fileName = `${candidate.id}/resume-${Date.now()}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from("resumes")
        .upload(fileName, resumeFile);

      if (uploadError) {
        setError("Failed to upload resume: " + uploadError.message);
        setLoading(false);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("resumes").getPublicUrl(fileName);
      resumeUrl = publicUrl;
    }

    // Upload portfolio items
    for (let i = 0; i < portfolioItems.length; i++) {
      const item = portfolioItems[i];
      const ext = item.file.name.split(".").pop()?.toLowerCase() || "pdf";
      const isImage = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
      const fileType = isImage ? "image" : "pdf";
      const fileName = `${candidate.id}/portfolio-${i}-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("portfolio")
        .upload(fileName, item.file);

      if (uploadError) {
        setError(`Failed to upload portfolio item ${i + 1}: ${uploadError.message}`);
        setLoading(false);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("portfolio").getPublicUrl(fileName);

      const { error: insertError } = await supabase
        .from("portfolio_items")
        .insert({
          candidate_id: candidate.id,
          file_url: publicUrl,
          file_type: fileType,
          description: item.description || null,
          display_order: i,
        });

      if (insertError) {
        setError(`Failed to save portfolio item ${i + 1}: ${insertError.message}`);
        setLoading(false);
        return;
      }
    }

    // Update candidate record
    const { error: updateError } = await supabase
      .from("candidates")
      .update({
        availability_status: availability,
        availability_date:
          availability === "available_by_date" ? availabilityDate : null,
        monthly_rate: parseInt(monthlyRate),
        resume_url: resumeUrl,
        payout_method: payoutMethod,
        admin_status: "pending_speaking_review",
      })
      .eq("id", candidate.id);

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    // Notify admin
    await fetch("/api/candidate/notify-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: candidate.id }),
    });

    onComplete();
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-text">Complete Your Profile</h1>
      <p className="mt-2 text-sm text-text/60">
        Finalize your profile details below. All fields marked as required must
        be completed before your profile can be submitted for review.
      </p>

      {/* Locked badges */}
      <div className="mt-6 grid grid-cols-2 gap-4">
        {candidate.english_written_tier && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-text/40">
              English Written Level
            </p>
            <p className="mt-1 text-lg font-semibold text-primary">
              {TIER_LABELS[candidate.english_written_tier] ||
                candidate.english_written_tier}
            </p>
            <p className="mt-1 text-xs text-text/40">Locked</p>
          </div>
        )}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-text/40">
            Speaking Level
          </p>
          <p className="mt-1 text-sm font-medium text-text/60">
            Pending Review
          </p>
          <p className="mt-1 text-xs text-text/40">
            Assigned after recording review
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-6">
        {/* Availability */}
        <div>
          <label className="block text-sm font-medium text-text">
            Availability
          </label>
          <select
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="available_now">Available now</option>
            <option value="available_by_date">Available by date</option>
            <option value="not_available">Not available</option>
          </select>
        </div>

        {availability === "available_by_date" && (
          <div>
            <label className="block text-sm font-medium text-text">
              Available From
            </label>
            <input
              type="date"
              required
              value={availabilityDate}
              onChange={(e) => setAvailabilityDate(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        )}

        {/* Monthly Rate */}
        <div>
          <label className="block text-sm font-medium text-text">
            Confirm Monthly Rate (USD)
          </label>
          <input
            type="number"
            required
            min="1"
            value={monthlyRate}
            onChange={(e) => setMonthlyRate(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Payout Method */}
        <div>
          <label className="block text-sm font-medium text-text">
            Payout Method <span className="text-red-500">*</span>
          </label>
          <p className="mt-0.5 text-xs text-text/40">
            How you want to receive payments from clients. Required.
          </p>
          <select
            required
            value={payoutMethod}
            onChange={(e) => setPayoutMethod(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Select payout method</option>
            <option value="payoneer">Payoneer</option>
            <option value="wise">Wise</option>
            <option value="bank_transfer">Local Bank Transfer</option>
          </select>
        </div>

        {/* Resume */}
        <div>
          <label className="block text-sm font-medium text-text">
            Resume (PDF only, max 5MB)
          </label>
          <input
            type="file"
            accept=".pdf"
            onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
            className="mt-1 block w-full text-sm text-text/60 file:mr-4 file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:bg-primary/20"
          />
        </div>

        {/* Portfolio */}
        <div>
          <label className="block text-sm font-medium text-text">
            Portfolio Items{" "}
            <span className="text-text/40 font-normal">
              (optional, up to {MAX_PORTFOLIO_ITEMS} items)
            </span>
          </label>
          <p className="mt-0.5 text-xs text-text/40">
            Upload PDF or image files (max 5MB each) with a short description.
          </p>

          {/* Existing items */}
          {portfolioItems.map((item, idx) => (
            <div
              key={idx}
              className="mt-3 flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3"
            >
              <div className="flex-1">
                <p className="text-sm font-medium text-text truncate">
                  {item.file.name}
                </p>
                <input
                  type="text"
                  maxLength={100}
                  placeholder="Brief description (optional)"
                  value={item.description}
                  onChange={(e) =>
                    updatePortfolioDescription(idx, e.target.value)
                  }
                  className="mt-1 block w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-text focus:border-primary focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => removePortfolioItem(idx)}
                className="shrink-0 text-xs text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ))}

          {/* Add button */}
          {portfolioItems.length < MAX_PORTFOLIO_ITEMS && (
            <label className="mt-3 flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 px-4 py-3 hover:border-primary/30 hover:bg-primary/5 transition-colors">
              <span className="text-sm text-text/60">
                + Add portfolio item ({portfolioItems.length}/{MAX_PORTFOLIO_ITEMS})
              </span>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.gif,.webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) addPortfolioItem(file);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {loading ? "Publishing..." : "Submit Profile for Review"}
        </button>
      </form>
    </div>
  );
}
