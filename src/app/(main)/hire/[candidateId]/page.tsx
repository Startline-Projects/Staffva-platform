"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import ContractReviewModal from "@/components/ContractReviewModal";

interface MilestoneEntry {
  title: string;
  description: string;
  amountUsd: string;
}

export default function HirePage() {
  const router = useRouter();
  const params = useParams();
  const candidateId = params.candidateId as string;

  const [candidateName, setCandidateName] = useState("");
  const [candidateRate, setCandidateRate] = useState(0);
  const [contractType, setContractType] = useState<"ongoing" | "project">("ongoing");
  const [paymentCycle, setPaymentCycle] = useState("monthly");
  const [rateOverride, setRateOverride] = useState("");
  const [milestones, setMilestones] = useState<MilestoneEntry[]>([
    { title: "", description: "", amountUsd: "" },
  ]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showContract, setShowContract] = useState(false);
  const [contractId, setContractId] = useState("");
  const [contractHtml, setContractHtml] = useState("");

  useEffect(() => {
    loadCandidate();
  }, [candidateId]);

  async function loadCandidate() {
    const supabase = createClient();
    const { data } = await supabase
      .from("candidates")
      .select("display_name, hourly_rate, lock_status")
      .eq("id", candidateId)
      .single();

    if (!data || data.lock_status === "locked") {
      router.push("/browse");
      return;
    }

    setCandidateName(data.display_name);
    setCandidateRate(data.hourly_rate);
    setRateOverride(data.hourly_rate.toString());
    setLoading(false);
  }

  function addMilestone() {
    setMilestones((prev) => [
      ...prev,
      { title: "", description: "", amountUsd: "" },
    ]);
  }

  function removeMilestone(index: number) {
    setMilestones((prev) => prev.filter((_, i) => i !== index));
  }

  function updateMilestone(index: number, field: keyof MilestoneEntry, value: string) {
    setMilestones((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: value } : m))
    );
  }

  const rate = Number(rateOverride) || candidateRate;
  const platformFee = Math.round(rate * 0.1 * 100) / 100;
  const clientTotal = Math.round((rate + platformFee) * 100) / 100;
  const milestoneTotal = milestones.reduce(
    (sum, m) => sum + (Number(m.amountUsd) || 0),
    0
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (contractType === "project") {
      if (milestones.some((m) => !m.title || !m.amountUsd)) {
        setError("Each milestone needs a title and amount.");
        return;
      }
    }

    setSubmitting(true);

    const payload: Record<string, unknown> = {
      candidateId,
      contractType,
      candidateRateUsd: rate,
    };

    if (contractType === "ongoing") {
      payload.paymentCycle = paymentCycle;
    } else {
      payload.milestones = milestones.map((m) => ({
        title: m.title,
        description: m.description,
        amountUsd: Number(m.amountUsd),
      }));
    }

    const res = await fetch("/api/engagements/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Failed to create engagement");
      setSubmitting(false);
      return;
    }

    // Generate contract for the new engagement
    const engagementId = data.engagement?.id;
    if (engagementId) {
      try {
        const contractRes = await fetch("/api/contracts/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ engagementId }),
        });

        const contractData = await contractRes.json();

        if (contractRes.ok && contractData.contractHtml) {
          setContractId(contractData.contractId);
          setContractHtml(contractData.contractHtml);
          setShowContract(true);
          setSubmitting(false);
          return;
        }
      } catch {
        // If contract generation fails, still redirect to team
        console.error("Contract generation failed, redirecting to team");
      }
    }

    // Fallback: redirect to team portal
    router.push("/team");
  }

  if (loading) {
    return (
      <main className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background">
        <p className="text-text/60">Loading...</p>
      </main>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Link
        href={`/candidate/${candidateId}`}
        className="inline-flex items-center text-sm text-text/60 hover:text-primary"
      >
        &larr; Back to Profile
      </Link>

      <h1 className="mt-6 text-2xl font-bold text-text">
        Hire {candidateName}
      </h1>
      <p className="mt-1 text-sm text-text/60">
        Set up the contract terms. You can start working once the first payment
        is funded.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-6">
        {/* Contract Type */}
        <div>
          <label className="block text-sm font-medium text-text mb-3">
            Contract Type
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setContractType("ongoing")}
              className={`rounded-xl border-2 p-4 text-left transition-colors ${
                contractType === "ongoing"
                  ? "border-primary bg-primary/5"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <p className="font-semibold text-text">Ongoing Role</p>
              <p className="mt-1 text-xs text-text/60">
                Recurring payments — weekly, biweekly, or monthly
              </p>
            </button>
            <button
              type="button"
              onClick={() => setContractType("project")}
              className={`rounded-xl border-2 p-4 text-left transition-colors ${
                contractType === "project"
                  ? "border-primary bg-primary/5"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <p className="font-semibold text-text">Project Milestone</p>
              <p className="mt-1 text-xs text-text/60">
                Defined deliverables — fund one milestone at a time
              </p>
            </button>
          </div>
        </div>

        {/* Rate */}
        <div>
          <label className="block text-sm font-medium text-text">
            {contractType === "ongoing"
              ? "Monthly Rate (USD)"
              : "Total Project Budget (USD)"}
          </label>
          <input
            type="number"
            required
            min="1"
            value={rateOverride}
            onChange={(e) => setRateOverride(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <p className="mt-1 text-xs text-text/40">
            Candidate listed rate: ${candidateRate.toLocaleString()}/hr
          </p>
        </div>

        {/* Ongoing: Payment Cycle */}
        {contractType === "ongoing" && (
          <div>
            <label className="block text-sm font-medium text-text">
              Payment Cycle
            </label>
            <select
              value={paymentCycle}
              onChange={(e) => setPaymentCycle(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        )}

        {/* Project: Milestones */}
        {contractType === "project" && (
          <div>
            <label className="block text-sm font-medium text-text mb-3">
              Milestones
            </label>
            <div className="space-y-3">
              {milestones.map((m, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-gray-200 bg-gray-50 p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-text/40">
                      Milestone {idx + 1}
                    </span>
                    {milestones.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMilestone(idx)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      required
                      placeholder="Title"
                      value={m.title}
                      onChange={(e) =>
                        updateMilestone(idx, "title", e.target.value)
                      }
                      className="col-span-2 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-text focus:border-primary focus:outline-none"
                    />
                    <input
                      type="number"
                      required
                      min="1"
                      placeholder="$ Amount"
                      value={m.amountUsd}
                      onChange={(e) =>
                        updateMilestone(idx, "amountUsd", e.target.value)
                      }
                      className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-text focus:border-primary focus:outline-none"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Description (optional)"
                    value={m.description}
                    onChange={(e) =>
                      updateMilestone(idx, "description", e.target.value)
                    }
                    className="mt-2 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-text focus:border-primary focus:outline-none"
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addMilestone}
              className="mt-3 text-sm text-primary hover:text-primary-dark"
            >
              + Add Milestone
            </button>
            {milestoneTotal > 0 && (
              <p className="mt-2 text-xs text-text/40">
                Total milestones: ${milestoneTotal.toLocaleString()}
              </p>
            )}
          </div>
        )}

        {/* Cost summary */}
        <div className="rounded-xl border border-gray-200 bg-card p-5">
          <h3 className="text-sm font-semibold text-text">Cost Summary</h3>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text/60">Professional&apos;s rate</span>
              <span className="text-text">
                ${rate.toLocaleString()}
                {contractType === "ongoing" && (
                  <span className="text-text/40">
                    /{paymentCycle === "weekly" ? "wk" : paymentCycle === "biweekly" ? "2wk" : "mo"}
                  </span>
                )}
              </span>
            </div>
            <div className="flex justify-between border-t border-gray-200 pt-2 font-semibold">
              <span className="text-text">Total</span>
              <span className="text-primary">${clientTotal.toLocaleString()}</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-text/40">
            Your payment is held in escrow until you approve.
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {submitting ? "Creating engagement..." : "Create Engagement"}
        </button>
      </form>

      {showContract && contractHtml && (
        <ContractReviewModal
          contractId={contractId}
          contractHtml={contractHtml}
          onSigned={() => router.push("/team")}
          onClose={() => router.push("/team")}
        />
      )}
    </div>
  );
}
