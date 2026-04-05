"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const CONTRACT_LENGTHS = ["1 month", "3 months", "6 months", "12 months", "Ongoing"];

export default function BuildOfferPage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = use(params);
  const router = useRouter();
  const [candidate, setCandidate] = useState<{ display_name: string; hourly_rate: number; role_category: string; country: string; profile_photo_url: string | null } | null>(null);
  const [hourlyRate, setHourlyRate] = useState(0);
  const [hoursPerWeek, setHoursPerWeek] = useState(40);
  const [contractLength, setContractLength] = useState("3 months");
  const [startDate, setStartDate] = useState("");
  const [signingBonus, setSigningBonus] = useState("");
  const [personalMessage, setPersonalMessage] = useState("");
  const [loadingMsg, setLoadingMsg] = useState(false);
  const [sending, setSending] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from("candidates").select("display_name, hourly_rate, role_category, country, profile_photo_url").eq("id", candidateId).single();
      if (data) {
        setCandidate(data);
        setHourlyRate(Number(data.hourly_rate));
      }
      // Generate AI message
      setLoadingMsg(true);
      try {
        const res = await fetch("/api/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate_message", candidateId }) });
        const d = await res.json();
        if (d.message) setPersonalMessage(d.message);
      } catch { /* silent */ }
      setLoadingMsg(false);
    }
    load();
    setStartDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]);
  }, [candidateId]);

  const monthlyCandidate = hourlyRate * hoursPerWeek * 4.33;
  const platformFee = monthlyCandidate * 0.10;
  const clientMonthly = monthlyCandidate + platformFee;
  const lengthMonths: Record<string, number> = { "1 month": 1, "3 months": 3, "6 months": 6, "12 months": 12, "Ongoing": 12 };
  const contractTotal = clientMonthly * (lengthMonths[contractLength] || 12);

  let comparison: "above" | "at" | "below" = "at";
  if (candidate && hourlyRate > Number(candidate.hourly_rate)) comparison = "above";
  else if (candidate && hourlyRate < Number(candidate.hourly_rate)) comparison = "below";

  async function handleSend() {
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_offer", candidateId, hourlyRate, hoursPerWeek, contractLength, startDate, signingBonus: signingBonus ? Number(signingBonus) : null, personalMessage }),
      });
      const d = await res.json();
      if (d.offer) { router.push("/team"); }
      else { setError(d.error || "Failed to send offer"); }
    } catch { setError("Something went wrong."); }
    setSending(false);
    setShowConfirm(false);
  }

  if (!candidate) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-text">Build Offer</h1>
      <p className="mt-1 text-sm text-text-muted">for {candidate.display_name} · {candidate.role_category} · {candidate.country}</p>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left — form */}
        <div className="lg:col-span-3 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text">Hourly Rate (USD)</label>
              <input type="number" min={1} max={500} step={0.5} value={hourlyRate} onChange={(e) => setHourlyRate(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-border-light bg-background px-4 py-3 text-sm text-text focus:border-primary focus:outline-none" />
              <p className="mt-1 text-xs text-text-tertiary">Candidate&apos;s stated rate: ${Number(candidate.hourly_rate)}/hr</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-text">Hours Per Week</label>
              <input type="number" min={1} max={50} value={hoursPerWeek} onChange={(e) => setHoursPerWeek(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-border-light bg-background px-4 py-3 text-sm text-text focus:border-primary focus:outline-none" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text">Contract Length</label>
              <select value={contractLength} onChange={(e) => setContractLength(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border-light bg-background px-4 py-3 text-sm text-text focus:border-primary focus:outline-none">
                {CONTRACT_LENGTHS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text">Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} min={new Date().toISOString().split("T")[0]}
                className="mt-1 w-full rounded-xl border border-border-light bg-background px-4 py-3 text-sm text-text focus:border-primary focus:outline-none" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text">Signing Bonus (optional)</label>
            <input type="number" min={0} value={signingBonus} onChange={(e) => setSigningBonus(e.target.value)} placeholder="0"
              className="mt-1 w-full rounded-xl border border-border-light bg-background px-4 py-3 text-sm text-text focus:border-primary focus:outline-none" />
          </div>

          <div>
            <label className="block text-sm font-medium text-text">Personal Message</label>
            {loadingMsg ? <p className="mt-1 text-xs text-text-tertiary animate-pulse">Generating message...</p> : null}
            <textarea value={personalMessage} onChange={(e) => setPersonalMessage(e.target.value)} rows={4}
              className="mt-1 w-full rounded-xl border border-border-light bg-background px-4 py-3 text-sm text-text focus:border-primary focus:outline-none resize-none" />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button onClick={() => setShowConfirm(true)} disabled={!hourlyRate || !hoursPerWeek || !startDate}
            className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50">
            Review and Send Offer
          </button>
        </div>

        {/* Right — preview */}
        <div className="lg:col-span-2">
          <div className="sticky top-24 rounded-2xl border border-border-light bg-card p-6 space-y-4">
            <h3 className="text-sm font-semibold text-text">Offer Preview</h3>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-text-muted">Professional&apos;s rate</span><span className="font-medium text-text">${hourlyRate}/hr × {hoursPerWeek} hrs</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Monthly equivalent</span><span className="font-medium text-text">${monthlyCandidate.toFixed(0)}</span></div>
              <div className="border-t border-border-light pt-3 flex justify-between"><span className="font-semibold text-text">Total/month</span><span className="font-semibold text-text">${clientMonthly.toFixed(0)}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Contract total ({contractLength})</span><span className="text-text">${contractTotal.toFixed(0)}</span></div>
              {signingBonus && Number(signingBonus) > 0 && (
                <div className="flex justify-between"><span className="text-text-muted">Signing bonus</span><span className="text-text">${Number(signingBonus).toFixed(0)}</span></div>
              )}
            </div>

            <div className={`mt-4 rounded-xl p-3 text-center text-xs font-medium ${
              comparison === "above" ? "bg-green-50 text-green-700" :
              comparison === "below" ? "bg-amber-50 text-amber-700" :
              "bg-gray-50 text-text-secondary"
            }`}>
              {comparison === "above" ? "Your offer is above their stated rate" :
               comparison === "below" ? "Your offer is below their stated rate" :
               "At their stated rate"}
            </div>
          </div>
        </div>
      </div>

      {/* Confirm modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowConfirm(false)}>
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-text">Confirm Offer</h2>
            <p className="mt-1 text-sm text-text-muted">Send this offer to {candidate.display_name}?</p>
            <div className="mt-4 rounded-xl bg-background p-4 text-sm space-y-2">
              <p><strong>${hourlyRate}/hr</strong> × {hoursPerWeek} hrs/week</p>
              <p>Contract: {contractLength} starting {new Date(startDate).toLocaleDateString()}</p>
              <p>Client total: <strong>${clientMonthly.toFixed(0)}/month</strong></p>
            </div>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setShowConfirm(false)} className="flex-1 rounded-full border border-border py-2.5 text-sm font-medium text-text">Cancel</button>
              <button onClick={handleSend} disabled={sending} className="flex-1 rounded-full bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50">
                {sending ? "Sending..." : "Send Offer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
