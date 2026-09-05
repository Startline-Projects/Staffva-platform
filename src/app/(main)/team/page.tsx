"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import EscrowStatusPanel from "@/components/EscrowStatusPanel";
import ContractReviewModal from "@/components/ContractReviewModal";
import EscrowPaymentModal from "@/components/escrow/EscrowPaymentModal";
import UpcomingInterviews from "@/components/interview/UpcomingInterviews";
import ReviewExchange from "@/components/reviews/ReviewExchange";
import type { ReviewState } from "@/lib/reviewEligibility";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
} from "recharts";

// ═══ STATUS MAPS ═══

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "Awaiting Funding", color: "bg-amber-100 text-amber-700" },
  funded: { label: "Funded — Period Active", color: "bg-green-100 text-green-700" },
  released: { label: "Released", color: "bg-gray-100 text-gray-600" },
  disputed: { label: "Dispute Filed", color: "bg-red-100 text-red-700" },
  refunded: { label: "Refunded", color: "bg-amber-100 text-amber-700" },
};

const MILESTONE_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-gray-100 text-gray-600" },
  funded: { label: "Funded", color: "bg-blue-100 text-blue-700" },
  candidate_marked_complete: { label: "Marked Complete", color: "bg-amber-100 text-amber-700" },
  approved: { label: "Approved", color: "bg-green-100 text-green-700" },
  released: { label: "Released", color: "bg-green-100 text-green-700" },
  disputed: { label: "Disputed", color: "bg-red-100 text-red-700" },
  refunded: { label: "Refunded", color: "bg-gray-100 text-gray-600" },
};

const ENG_STATUS: Record<string, { label: string; color: string }> = {
  active: { label: "Active", color: "bg-green-100 text-green-700" },
  payment_failed: { label: "Payment Failed", color: "bg-red-100 text-red-700" },
  released: { label: "Released", color: "bg-gray-100 text-gray-600" },
  completed: { label: "Completed", color: "bg-blue-100 text-blue-700" },
};

const CONTRACT_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-gray-100 text-gray-600" },
  pending_client: { label: "Awaiting Your Signature", color: "bg-amber-100 text-amber-700" },
  pending_candidate: { label: "Awaiting Contractor Signature", color: "bg-blue-100 text-blue-700" },
  fully_executed: { label: "Fully Executed", color: "bg-green-100 text-green-700" },
};

// ═══ INTERFACES ═══

interface Engagement {
  id: string;
  candidate_id: string;
  contract_type: string;
  payment_cycle: string | null;
  candidate_rate_usd: number;
  platform_fee_usd: number;
  client_total_usd: number;
  status: string;
  created_at: string;
  candidate: {
    display_name: string;
    role_category: string;
    lock_status: string;
  } | null;
  latest_period: {
    id: string;
    period_start: string;
    period_end: string;
    status: string;
  } | null;
  milestones: {
    id: string;
    title: string;
    amount_usd: number;
    status: string;
  }[];
  contract: {
    id: string;
    status: string;
    contract_pdf_url: string | null;
    client_signed_at: string | null;
    candidate_signed_at: string | null;
  } | null;
}

interface OfferRow {
  id: string;
  status: string;
  hourly_rate: number;
  hours_per_week: number;
  contract_length: string;
  sent_at: string | null;
  responded_at: string | null;
  candidates: {
    display_name: string | null;
    role_category: string | null;
    profile_photo_url: string | null;
  } | null;
}

const OFFER_LABELS: Record<string, { label: string; color: string }> = {
  sent: { label: "Awaiting response", color: "bg-amber-100 text-amber-700" },
  viewed: { label: "Viewed", color: "bg-blue-100 text-blue-700" },
  accepted: { label: "Accepted", color: "bg-green-100 text-green-700" },
  declined: { label: "Declined", color: "bg-gray-100 text-gray-600" },
  expired: { label: "Expired", color: "bg-gray-100 text-gray-500" },
};

interface DashboardStats {
  activeHires: number;
  candidatesContacted: number;
  interviewsCompleted: number;
  totalSpend: number;
}

interface TopMatch {
  id: string;
  display_name: string;
  role_category: string;
  profile_photo_url: string | null;
  overall_score: number;
}

interface HiringMonth {
  month: string;
  count: number;
}

interface Pipeline {
  browsed: number;
  messaged: number;
  interviewed: number;
  contracted: number;
}

// ═══ MAIN COMPONENT ═══

export default function TeamPortalPage() {
  const router = useRouter();
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [clientId, setClientId] = useState("");
  const [reviewState, setReviewState] = useState<ReviewState[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [payModal, setPayModal] = useState<{
    engagementId: string;
    periodId?: string;
    milestoneId?: string;
    title: string;
  } | null>(null);
  const [fundingInFlight, setFundingInFlight] = useState<Set<string>>(new Set());
  const [returnBanner, setReturnBanner] = useState<"succeeded" | "processing" | "failed" | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Never leave the poll running after navigation.
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);
  const [showContract, setShowContract] = useState(false);
  const [activeContractId, setActiveContractId] = useState("");
  const [activeContractHtml, setActiveContractHtml] = useState("");

  // Dashboard state
  const [stats, setStats] = useState<DashboardStats>({ activeHires: 0, candidatesContacted: 0, interviewsCompleted: 0, totalSpend: 0 });
  const [hiringActivity, setHiringActivity] = useState<HiringMonth[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline>({ browsed: 0, messaged: 0, interviewed: 0, contracted: 0 });
  const [topMatches, setTopMatches] = useState<TopMatch[]>([]);
  const [chartRange, setChartRange] = useState<"3M" | "6M" | "All">("6M");
  const [showPastEngagements, setShowPastEngagements] = useState(false);
  const [offers, setOffers] = useState<OfferRow[]>([]);

  useEffect(() => {
    loadEngagements();
    loadDashboard();
    loadOffers();
    loadReviews();
  }, []);

  async function loadReviews() {
    try {
      const res = await fetch("/api/reviews/mine");
      const data = await res.json();
      if (res.ok) setReviewState(data.engagements || []);
    } catch {
      /* the review block simply doesn't render */
    }
  }

  async function loadOffers() {
    try {
      const res = await fetch("/api/offers");
      const data = await res.json();
      if (res.ok) setOffers(data.offers || []);
    } catch {
      /* the section simply doesn't render */
    }
  }

  async function loadEngagements() {
    const res = await fetch("/api/engagements/list");
    const data = await res.json();
    setEngagements(data.engagements || []);
    setClientId(data.clientId || "");
    setLoading(false);
  }

  async function loadDashboard() {
    try {
      const res = await fetch("/api/dashboard/stats");
      const data = await res.json();
      if (res.ok) {
        setStats(data.stats || stats);
        setHiringActivity(data.hiringActivity || []);
        setPipeline(data.pipeline || pipeline);
        setTopMatches(data.topMatches || []);
        if (data.clientId) setClientId(data.clientId);
      }
    } catch { /* silent */ }
  }

  // ═══ ENGAGEMENT ACTIONS ═══

  // Fund the CURRENT period if it's awaiting payment; otherwise create the
  // next period and fund that. Either way the money moves through the
  // payment modal — creating a row was never funding anything.
  async function handleFundPeriod(eng: Engagement) {
    if (eng.latest_period && eng.latest_period.status === "pending") {
      setPayModal({
        engagementId: eng.id,
        periodId: eng.latest_period.id,
        title: `Fund this period — ${eng.candidate?.display_name || "your hire"}`,
      });
      return;
    }
    setActionLoading(eng.id);
    const res = await fetch("/api/engagements/periods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId: eng.id }),
    });
    const data = await res.json().catch(() => ({}));
    setActionLoading(null);
    // 409 hands back the still-unfunded current period — fund that one.
    const period = data.period;
    if (period?.id) {
      await loadEngagements();
      setPayModal({
        engagementId: eng.id,
        periodId: period.id,
        title: `Fund this period — ${eng.candidate?.display_name || "your hire"}`,
      });
    } else {
      alert(data.error || "Couldn't prepare the period — try again.");
    }
  }

  function handleFundMilestone(eng: Engagement, ms: Engagement["milestones"][number]) {
    setPayModal({
      engagementId: eng.id,
      milestoneId: ms.id,
      title: `Fund milestone — ${ms.title}`,
    });
  }

  // The webhook does the bookkeeping. Mark the paid row as in flight (its
  // Fund button flips to "Payment processing…" until the status changes)
  // and poll until the webhook lands — bounded, and cleaned up on unmount.
  function handlePaid() {
    const id = payModal?.periodId || payModal?.milestoneId;
    if (id) setFundingInFlight((prev) => new Set(prev).add(id));
    startPolling();
  }

  function startPolling() {
    if (pollRef.current) return;
    let ticks = 0;
    pollRef.current = setInterval(() => {
      ticks++;
      loadEngagements();
      if (ticks >= 40 && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 3000);
  }

  async function handleRelease(engagementId: string) {
    if (!confirm("Release this candidate? Their profile will go live on browse immediately.")) return;
    setActionLoading(engagementId);
    const res = await fetch("/api/engagements/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Couldn't release the engagement — try again.");
    }
    await loadEngagements();
    setActionLoading(null);
  }

  async function handleApproveMilestone(milestoneId: string) {
    setActionLoading(milestoneId);
    const res = await fetch("/api/engagements/milestones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ milestoneId, action: "approve" }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Couldn't approve the milestone — try again.");
    }
    await loadEngagements();
    setActionLoading(null);
  }

  async function handleViewContract(contractId: string) {
    setActionLoading(contractId);
    try {
      const res = await fetch(`/api/contracts/view?contractId=${contractId}`);
      const data = await res.json();
      if (res.ok && data.contractHtml) {
        setActiveContractId(contractId);
        setActiveContractHtml(data.contractHtml);
        setShowContract(true);
      }
    } catch { /* silent */ }
    setActionLoading(null);
  }

  async function handleDownloadContract(contractId: string) {
    setActionLoading(contractId);
    try {
      const res = await fetch(`/api/contracts/view?contractId=${contractId}`);
      const data = await res.json();
      if (res.ok && data.contractPdfUrl) {
        window.open(data.contractPdfUrl, "_blank");
      }
    } catch { /* silent */ }
    setActionLoading(null);
  }

  const activeEngagements = engagements.filter((e) => e.status === "active");
  const pastEngagements = engagements.filter((e) => e.status !== "active");

  // Chart data based on range
  const chartData = chartRange === "3M" ? hiringActivity.slice(-3) : chartRange === "6M" ? hiringActivity.slice(-6) : hiringActivity;

  // Pipeline total
  const pipelineTotal = pipeline.browsed + pipeline.messaged + pipeline.interviewed + pipeline.contracted;
  const maxPipeline = Math.max(pipeline.browsed, pipeline.messaged, pipeline.interviewed, pipeline.contracted, 1);

  if (loading) {
    return (
      <main className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background">
        <p className="text-text/60">Loading your dashboard...</p>
      </main>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* A redirect-based payment (bank, wallet) returns here with Stripe's
          outcome in the URL — read it, say what happened, start the poll. */}
      <Suspense fallback={null}>
        <StripeReturnReader
          onReturn={(status) => {
            setReturnBanner(status);
            if (status !== "failed") startPolling();
          }}
        />
      </Suspense>
      {returnBanner && (
        <div
          className={`mb-6 flex items-start justify-between rounded-lg border p-4 text-sm ${
            returnBanner === "failed"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-green-200 bg-green-50 text-green-800"
          }`}
        >
          <p>
            {returnBanner === "succeeded" &&
              "Payment received — your escrow is updating and the period below flips to Funded in a moment."}
            {returnBanner === "processing" &&
              "Payment initiated — bank payments take a few business days to settle. Don't pay again; this payment is tracked."}
            {returnBanner === "failed" &&
              "The payment didn't go through — nothing was charged. You can try again below."}
          </p>
          <button
            onClick={() => setReturnBanner(null)}
            aria-label="Dismiss"
            className="ml-4 shrink-0 opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* ═══ HEADER ═══ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">Dashboard</h1>
          <p className="mt-0.5 text-sm text-text-muted">Your hiring activity and team overview</p>
        </div>
        <button
          onClick={() => router.push("/browse")}
          className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors min-h-[44px]"
        >
          Browse Talent
        </button>
      </div>

      {/* ═══ STAT CARDS ═══ */}
      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Hires" value={stats.activeHires} icon={<UsersIcon />} />
        <StatCard label="Candidates Contacted" value={stats.candidatesContacted} icon={<ChatIcon />} />
        <StatCard label="Interviews Completed" value={stats.interviewsCompleted} icon={<ClipboardIcon />} />
        <StatCard label="Total Platform Spend" value={`$${stats.totalSpend.toLocaleString()}`} icon={<DollarIcon />} />
      </div>

      {/* ═══ UPCOMING INTERVIEWS (renders nothing when there are none) ═══ */}
      <div className="mt-6 empty:mt-0">
        <UpcomingInterviews />
      </div>

      {/* ═══ CHART + PIPELINE ROW ═══ */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Hiring Activity Chart */}
        <div className="lg:col-span-2 rounded-xl border border-border-light bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-text">Hiring Activity</h2>
            <div className="flex gap-1">
              {(["3M", "6M", "All"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setChartRange(r)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    chartRange === r ? "bg-primary text-white" : "text-text-muted hover:bg-gray-100"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e0d8" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9a9590" }} />
                <YAxis tick={{ fontSize: 11, fill: "#9a9590" }} allowDecimals={false} />
                <RechartsTooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e4e0d8" }}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#FE6E3E"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "#FE6E3E", stroke: "#fff", strokeWidth: 2 }}
                  name="Hires"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Candidate Pipeline */}
        <div className="rounded-xl border border-border-light bg-card p-6">
          <h2 className="text-sm font-semibold text-text mb-4">Candidate Pipeline</h2>
          <div className="space-y-3.5">
            <PipelineBar label="Browsed" count={pipeline.browsed} max={maxPipeline} color="bg-gray-300" />
            <PipelineBar label="Messaged" count={pipeline.messaged} max={maxPipeline} color="bg-amber-500" />
            <PipelineBar label="Interviewed" count={pipeline.interviewed} max={maxPipeline} color="bg-primary" />
            <PipelineBar label="Contracted" count={pipeline.contracted} max={maxPipeline} color="bg-charcoal" />
          </div>
          <p className="mt-4 text-xs text-text-tertiary">
            {pipelineTotal} total candidate{pipelineTotal !== 1 ? "s" : ""} in pipeline
          </p>
        </div>
      </div>

      {/* ═══ TOP MATCHES ═══ */}
      {topMatches.length > 0 && (
        <div className="mt-6 rounded-xl border border-border-light bg-card p-6">
          <h2 className="text-sm font-semibold text-text mb-4">Top Matches</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {topMatches.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg border border-border-light p-3">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-background">
                  {c.profile_photo_url ? (
                    <img src={c.profile_photo_url} alt={c.display_name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-text-tertiary">
                      {c.display_name?.[0] || "?"}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text truncate">{c.display_name}</p>
                  <p className="text-xs text-text-tertiary truncate">{c.role_category}</p>
                </div>
                <div className="flex flex-col items-center gap-1">
                  {c.overall_score > 0 && (
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                      c.overall_score >= 80 ? "border-primary" : c.overall_score >= 60 ? "border-amber-500" : "border-gray-300"
                    }`}>
                      <span className={`text-xs font-bold ${
                        c.overall_score >= 80 ? "text-primary" : c.overall_score >= 60 ? "text-amber-600" : "text-gray-400"
                      }`}>{c.overall_score}</span>
                    </div>
                  )}
                  <Link
                    href={`/candidate/${c.id}`}
                    className="text-[10px] font-medium text-primary hover:underline"
                  >
                    View
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ OFFERS ═══ */}
      {offers.length > 0 && (
        <div className="mt-6" id="offers">
          <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider">
            Offers ({offers.length})
          </h2>
          <div className="mt-4 space-y-2">
            {offers.map((o) => (
              <div
                key={o.id}
                className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text">
                    {o.candidates?.display_name || "Candidate"}
                    <span className="ml-2 font-normal text-text/50">
                      {o.candidates?.role_category}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-text/60">
                    ${Number(o.hourly_rate)}/hr · {o.hours_per_week} hrs/week · {o.contract_length}
                    {o.sent_at && ` · sent ${new Date(o.sent_at).toLocaleDateString()}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${OFFER_LABELS[o.status]?.color || "bg-gray-100 text-gray-600"}`}
                  >
                    {OFFER_LABELS[o.status]?.label || o.status}
                  </span>
                  {o.status === "accepted" && (
                    <span className="text-xs text-text/50">contract in progress below</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ ACTIVE ENGAGEMENTS ═══ */}
      {activeEngagements.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider">
            Active Hires ({activeEngagements.length})
          </h2>
          <div className="mt-4 space-y-4">
            {activeEngagements.map((eng) => (
              <div key={eng.id} className="rounded-xl border border-gray-200 bg-card p-6">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-lg font-semibold text-text">
                      {eng.candidate?.display_name || "Unknown"}
                    </p>
                    <p className="text-sm text-text/60">
                      {eng.candidate?.role_category} &middot;{" "}
                      {eng.contract_type === "ongoing"
                        ? `Ongoing (${eng.payment_cycle})`
                        : "Project"}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${ENG_STATUS[eng.status]?.color || "bg-gray-100 text-gray-600"}`}>
                    {ENG_STATUS[eng.status]?.label || eng.status}
                  </span>
                </div>

                {/* Rate info */}
                <div className="mt-4 flex gap-6 text-sm">
                  <div>
                    <p className="text-xs text-text/40">Professional&apos;s Rate</p>
                    <p className="font-medium text-text">${Number(eng.candidate_rate_usd).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text/40">Total</p>
                    <p className="font-semibold text-primary">${Number(eng.client_total_usd).toLocaleString()}</p>
                  </div>
                </div>
                <p className="mt-1 text-[10px] text-text/30">Your payment is held in escrow until you approve.</p>

                {/* Contract status */}
                {eng.contract && (
                  <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <svg className="h-5 w-5 text-text/40" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                      <div>
                        <p className="text-xs text-text/40">Contract</p>
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CONTRACT_STATUS[eng.contract.status]?.color || "bg-gray-100"}`}>
                          {CONTRACT_STATUS[eng.contract.status]?.label || eng.contract.status}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {eng.contract.status === "pending_client" && (
                        <button
                          onClick={() => handleViewContract(eng.contract!.id)}
                          disabled={actionLoading === eng.contract.id}
                          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
                        >
                          Review & Sign
                        </button>
                      )}
                      {eng.contract.status === "fully_executed" && eng.contract.contract_pdf_url && (
                        <button
                          onClick={() => handleDownloadContract(eng.contract!.id)}
                          disabled={actionLoading === eng.contract.id}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-text hover:bg-gray-50 transition-colors disabled:opacity-50"
                        >
                          Download PDF
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Ongoing: latest period */}
                {eng.contract_type === "ongoing" && eng.latest_period && (
                  <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-text/40">Current Period</p>
                      <p className="text-sm text-text">
                        {new Date(eng.latest_period.period_start).toLocaleDateString()} —{" "}
                        {new Date(eng.latest_period.period_end).toLocaleDateString()}
                      </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_LABELS[eng.latest_period.status]?.color || "bg-gray-100"}`}>
                      {STATUS_LABELS[eng.latest_period.status]?.label || eng.latest_period.status}
                    </span>
                  </div>
                )}

                {/* Ongoing: fund the pending period, or start the next one */}
                {eng.contract_type === "ongoing" && (
                  <div className="mt-4">
                    {eng.latest_period &&
                    eng.latest_period.status === "pending" &&
                    fundingInFlight.has(eng.latest_period.id) ? (
                      <button
                        disabled
                        className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-text-secondary"
                      >
                        Payment processing…
                      </button>
                    ) : (
                      <button
                        onClick={() => handleFundPeriod(eng)}
                        disabled={actionLoading === eng.id}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {actionLoading === eng.id
                          ? "Preparing…"
                          : eng.latest_period?.status === "pending"
                            ? "Fund This Period"
                            : "Fund Next Period"}
                      </button>
                    )}
                  </div>
                )}

                {/* Project: milestones */}
                {eng.contract_type === "project" && eng.milestones.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-text/40 mb-2">Milestones</p>
                    <div className="space-y-2">
                      {eng.milestones.map((ms) => (
                        <div
                          key={ms.id}
                          className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
                        >
                          <div>
                            <p className="text-sm font-medium text-text">{ms.title}</p>
                            <p className="text-xs text-text/40">${Number(ms.amount_usd).toLocaleString()}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${MILESTONE_LABELS[ms.status]?.color || "bg-gray-100"}`}>
                              {MILESTONE_LABELS[ms.status]?.label || ms.status}
                            </span>
                            {ms.status === "pending" &&
                              (fundingInFlight.has(ms.id) ? (
                                <span className="rounded bg-gray-200 px-3 py-1 text-xs font-semibold text-text-secondary">
                                  Payment processing…
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleFundMilestone(eng, ms)}
                                  className="rounded bg-primary px-3 py-1 text-xs font-semibold text-white hover:bg-primary/90"
                                >
                                  Fund
                                </button>
                              ))}
                            {ms.status === "candidate_marked_complete" && (
                              <button
                                onClick={() => handleApproveMilestone(ms.id)}
                                disabled={actionLoading === ms.id}
                                className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                              >
                                Approve
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Review — only once money has actually moved. The block
                    renders its own "not yet" state rather than being hidden,
                    so the rule is visible before it applies rather than
                    appearing out of nowhere the day it does. */}
                {reviewState.some((r) => r.engagement_id === eng.id) && (
                  <div className="mt-4">
                    <ReviewExchange
                      state={reviewState.find((r) => r.engagement_id === eng.id)!}
                      onChange={loadReviews}
                    />
                  </div>
                )}

                {/* Actions */}
                <div className="mt-4 flex gap-3 border-t border-gray-100 pt-4">
                  <button
                    onClick={() => router.push(`/inbox?candidate=${eng.candidate_id}&client=${clientId}`)}
                    className="text-sm text-primary hover:text-primary-dark"
                  >
                    Message
                  </button>
                  <button
                    onClick={() => handleRelease(eng.id)}
                    disabled={actionLoading === eng.id}
                    className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    Release Candidate
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ ESCROW STATUS ═══ */}
      <div className="mt-6">
        <EscrowStatusPanel role="client" />
      </div>

      {/* ═══ PAST ENGAGEMENTS ═══ */}
      {pastEngagements.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowPastEngagements(!showPastEngagements)}
            className="flex items-center gap-2 text-sm font-semibold text-text/40 uppercase tracking-wider hover:text-text/60 transition-colors"
          >
            Past ({pastEngagements.length})
            <svg
              className={`h-4 w-4 transition-transform ${showPastEngagements ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          {showPastEngagements && (
            <div className="mt-4 space-y-3">
              {pastEngagements.map((eng) => (
                <div
                  key={eng.id}
                  className="rounded-xl border border-gray-200 bg-card px-6 py-4"
                >
                  <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-text">
                      {eng.candidate?.display_name || "Unknown"}
                    </p>
                    <p className="text-xs text-text/60">
                      {eng.candidate?.role_category} &middot;{" "}
                      {eng.contract_type === "ongoing" ? "Ongoing" : "Project"} &middot;{" "}
                      Started {new Date(eng.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {eng.contract?.status === "fully_executed" && eng.contract.contract_pdf_url && (
                      <button
                        onClick={() => handleDownloadContract(eng.contract!.id)}
                        className="text-xs text-primary hover:underline"
                      >
                        Download Contract
                      </button>
                    )}
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${ENG_STATUS[eng.status]?.color || "bg-gray-100"}`}>
                      {ENG_STATUS[eng.status]?.label || eng.status}
                    </span>
                  </div>
                  </div>

                  {reviewState.some((r) => r.engagement_id === eng.id) && (
                    <div className="mt-3">
                      <ReviewExchange
                        state={reviewState.find((r) => r.engagement_id === eng.id)!}
                        onChange={loadReviews}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ RESOURCES ═══ */}
      <div className="mt-6 rounded-xl border border-border-light bg-card p-6">
        <h2 className="text-sm font-semibold text-text mb-4">Resources</h2>
        <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 text-text/40 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-text">StaffVA Scope of Services</p>
              <p className="text-xs text-text/50">Platform capabilities, deliverables &amp; service terms</p>
            </div>
          </div>
          <a
            href="/StaffVA_Scope_v6_5.docx"
            download
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-text hover:bg-gray-100 transition-colors whitespace-nowrap"
          >
            Download
          </a>
        </div>
      </div>

      {/* Empty state */}
      {engagements.length === 0 && topMatches.length === 0 && (
        <div className="mt-12 text-center">
          <p className="text-lg font-medium text-text">Welcome to StaffVA</p>
          <p className="mt-1 text-sm text-text/60">
            Browse candidates and hire your first team member to see your dashboard come to life.
          </p>
        </div>
      )}

      {/* Contract Review Modal */}
      {showContract && activeContractHtml && (
        <ContractReviewModal
          contractId={activeContractId}
          contractHtml={activeContractHtml}
          onSigned={() => {
            setShowContract(false);
            loadEngagements();
          }}
          onClose={() => setShowContract(false)}
        />
      )}

      {payModal && (
        <EscrowPaymentModal
          engagementId={payModal.engagementId}
          periodId={payModal.periodId}
          milestoneId={payModal.milestoneId}
          title={payModal.title}
          onClose={() => setPayModal(null)}
          onPaid={handlePaid}
        />
      )}
    </div>
  );
}

// ═══ SUB-COMPONENTS ═══

function StripeReturnReader({
  onReturn,
}: {
  onReturn: (status: "succeeded" | "processing" | "failed") => void;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const reported = useRef(false);

  useEffect(() => {
    const status = searchParams.get("redirect_status");
    if (!status || reported.current) return;
    reported.current = true;
    // Deferred so the parent's setState never runs synchronously inside an
    // effect, and the Stripe params don't survive into history.
    const t = setTimeout(() => {
      onReturn(status === "succeeded" ? "succeeded" : status === "processing" ? "processing" : "failed");
      router.replace("/team", { scroll: false });
    }, 0);
    return () => clearTimeout(t);
  }, [searchParams, onReturn, router]);

  return null;
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border-light bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide">{label}</p>
        <div className="text-text/30">{icon}</div>
      </div>
      <p className="mt-2 text-2xl font-bold text-text">{value}</p>
    </div>
  );
}

function PipelineBar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  const width = max > 0 ? Math.max((count / max) * 100, count > 0 ? 8 : 0) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-text-secondary">{label}</span>
        <span className="text-xs font-semibold text-text tabular-nums">{count}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100">
        <div className={`h-2 rounded-full ${color} transition-all duration-500`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

// ═══ ICONS ═══

function UsersIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
    </svg>
  );
}

function DollarIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
