"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import EscrowStatusPanel from "@/components/EscrowStatusPanel";
import GiveawayTracker from "@/components/GiveawayTracker";
import LockoutCard from "@/components/LockoutCard";

interface DailyCount {
  day: string;
  label: string;
  count: number;
}

interface ViewStats {
  weekViews: number;
  monthViews: number;
  totalViews: number;
  dailyCounts?: DailyCount[];
  todayViews?: number;
}

interface CandidateData {
  id: string;
  display_name: string;
  admin_status: string;
  role_category: string;
  hourly_rate: number;
  availability_status: string;
  total_earnings_usd: number;
  profile_photo_url: string | null;
  english_written_tier: string | null;
  speaking_level: string | null;
  tagline: string | null;
  bio: string | null;
  skills: string[] | null;
  tools: string[] | null;
  work_experience: unknown[] | null;
  resume_url: string | null;
  payout_method: string | null;
  payout_status: string | null;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean | null;
  english_mc_score: number | null;
  voice_recording_1_url: string | null;
  voice_recording_2_url: string | null;
  profile_completed_at: string | null;
  id_verification_status: string | null;
  application_step: string | null;
  video_intro_status: string | null;
  video_intro_url: string | null;
  spoken_english_score: number | null;
  spoken_english_result: string | null;
  id_verification_consent: boolean | null;
  results_display_unlocked: boolean | null;
  profile_went_live_at: string | null;
  video_intro_admin_note: string | null;
  assigned_recruiter: string | null;
  ai_interview_completed_at: string | null;
  english_comprehension_score: number | null;
  interview_consent_at: string | null;
  second_interview_status: string | null;
  test_lockout_until: string | null;
}

interface InterviewData {
  interview_number: number;
  status: string;
  communication_score: number | null;
  demeanor_score: number | null;
  role_knowledge_score: number | null;
}

interface AIInterviewData {
  id: string;
  status: string;
  overall_score: number | null;
  badge_level: string | null;
  passed: boolean;
  created_at: string;
  completed_at: string | null;
  second_interview_status: string | null;
}

interface RetakeData {
  next_retake_available_at: string | null;
  attempt_number: number;
}

interface CompletenessItem {
  label: string;
  points: number;
  complete: boolean;
  tip: string;
  link: string;
}

function calculateCompleteness(c: CandidateData, hasPortfolio: boolean): { score: number; items: CompletenessItem[] } {
  const items: CompletenessItem[] = [
    {
      label: "Profile photo",
      points: 10,
      complete: !!c.profile_photo_url,
      tip: "Upload a professional photo to make your profile stand out",
      link: "/apply",
    },
    {
      label: "Tagline",
      points: 10,
      complete: !!c.tagline && c.tagline.length > 0,
      tip: "Add a short tagline describing your expertise",
      link: "/apply",
    },
    {
      label: "Bio",
      points: 10,
      complete: !!c.bio && c.bio.length > 0,
      tip: "Write a bio telling clients about your background",
      link: "/apply",
    },
    {
      label: "At least 3 skills",
      points: 10,
      complete: Array.isArray(c.skills) && c.skills.length >= 3,
      tip: "Add at least 3 key skills to your profile",
      link: "/apply",
    },
    {
      label: "At least 3 tools",
      points: 10,
      complete: Array.isArray(c.tools) && c.tools.length >= 3,
      tip: "List the tools and software you use regularly",
      link: "/apply",
    },
    {
      label: "Work experience",
      points: 15,
      complete: Array.isArray(c.work_experience) && c.work_experience.length >= 1,
      tip: "Add at least one work experience entry",
      link: "/apply",
    },
    {
      label: "Resume uploaded",
      points: 15,
      complete: !!c.resume_url,
      tip: "Upload your resume so clients can review your full background",
      link: "/apply",
    },
    {
      label: "Portfolio item",
      points: 10,
      complete: hasPortfolio,
      tip: "Add a work sample, cover letter, or certificate",
      link: "/apply",
    },
    {
      label: "Payout method",
      points: 10,
      complete: !!c.payout_method,
      tip: "Set up your payout method to receive payments",
      link: "/apply",
    },
  ];

  const score = items.reduce((sum, item) => sum + (item.complete ? item.points : 0), 0);
  return { score, items };
}

interface ContractItem {
  id: string;
  engagement_id: string;
  status: string;
  generated_at: string;
  client_signed_at: string | null;
  candidate_signed_at: string | null;
  contract_pdf_url: string | null;
  clients: { full_name: string; company_name: string | null } | null;
}

const CONTRACT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending_candidate: { label: "Awaiting Your Signature", color: "bg-amber-100 text-amber-700" },
  fully_executed: { label: "Fully Executed", color: "bg-green-100 text-green-700" },
  pending_client: { label: "Awaiting Client Signature", color: "bg-blue-100 text-blue-700" },
  draft: { label: "Draft", color: "bg-gray-100 text-gray-600" },
};

function ContractsSection() {
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/contracts/list");
        const data = await res.json();
        setContracts(data.contracts || []);
      } catch { /* silent */ }
      setLoaded(true);
    }
    load();
  }, []);

  if (!loaded || contracts.length === 0) return null;

  return (
    <div className="mb-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Contracts</h2>
      <div className="space-y-3">
        {contracts.map((c) => {
          const clientInfo = c.clients as { full_name: string; company_name: string | null } | null;
          const statusInfo = CONTRACT_STATUS_LABELS[c.status] || { label: c.status, color: "bg-gray-100 text-gray-600" };

          return (
            <div key={c.id} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-[#1C1B1A]">
                  {clientInfo?.company_name || clientInfo?.full_name || "Client"}
                </p>
                <p className="text-xs text-gray-500">
                  Generated {new Date(c.generated_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusInfo.color}`}>
                  {statusInfo.label}
                </span>
                {c.status === "pending_candidate" && (
                  <a
                    href={`/contracts/sign/${c.id}`}
                    className="rounded-lg bg-[#FE6E3E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e55a2b] transition-colors"
                  >
                    Review & Sign
                  </a>
                )}
                {c.status === "fully_executed" && c.contract_pdf_url && (
                  <a
                    href={c.contract_pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#FE6E3E] hover:underline"
                  >
                    Download PDF
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ReputationData {
  aiScore: number;
  reviewScore: number;
  completenessScore: number;
  aiContribution: number;
  reviewContribution: number;
  completenessContribution: number;
  totalScore: number;
  tier: string | null;
  percentile: number | null;
}

const TIER_COLORS: Record<string, { bg: string; text: string }> = {
  Elite: { bg: "bg-amber-700", text: "text-amber-100" },
  "Top Rated": { bg: "bg-[#FE6E3E]", text: "text-white" },
  Rising: { bg: "bg-amber-500", text: "text-white" },
  Established: { bg: "bg-gray-500", text: "text-white" },
};

type StageState = "failed" | "retake-ready" | undefined;

function MobileProgressTracker({ currentIndex, currentStageName, progressPercent, stages }: {
  currentIndex: number; currentStageName: string; progressPercent: number;
  stages: { label: string; done: boolean; state?: StageState }[];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="sm:hidden">
      {/* Collapsed view */}
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">Stage {Math.min(currentIndex + 1, stages.length)} of {stages.length}</p>
            <p className="text-sm font-semibold text-[#1C1B1A]">{currentStageName}</p>
          </div>
          <svg className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100">
          <div className="h-1.5 rounded-full bg-[#FE6E3E] transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
      </button>

      {/* Expanded: all 7 stages */}
      {expanded && (
        <div className="mt-4 space-y-2">
          {stages.map((stage, i) => (
            <div key={stage.label} className="flex items-center gap-3">
              {stage.state === "failed" ? (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500">
                  <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </div>
              ) : stage.state === "retake-ready" ? (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-white" />
                </div>
              ) : stage.done ? (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-500">
                  <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                </div>
              ) : i === currentIndex ? (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#FE6E3E]/20 ring-2 ring-[#FE6E3E]">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-[#FE6E3E]" />
                </div>
              ) : (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100">
                  <div className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                </div>
              )}
              <span className={`text-sm ${stage.state === "failed" ? "text-red-600 font-medium" : stage.state === "retake-ready" ? "text-amber-600 font-medium" : stage.done ? "text-green-600 font-medium" : i === currentIndex ? "text-[#1C1B1A] font-medium" : "text-gray-400"}`}>{stage.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AIInterviewDimensions({ candidateId }: { candidateId: string }) {
  const [dimensions, setDimensions] = useState<{ label: string; score: number }[] | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("ai_interviews")
        .select("technical_knowledge_score, problem_solving_score, communication_score, experience_depth_score, professionalism_score")
        .eq("candidate_id", candidateId)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        setDimensions([
          { label: "Technical Knowledge", score: Math.round((data.technical_knowledge_score || 0) * 5) },
          { label: "Problem Solving", score: Math.round((data.problem_solving_score || 0) * 5) },
          { label: "Communication", score: Math.round((data.communication_score || 0) * 5) },
          { label: "Experience Depth", score: Math.round((data.experience_depth_score || 0) * 5) },
          { label: "Professionalism", score: Math.round((data.professionalism_score || 0) * 5) },
        ]);
      }
    }
    load();
  }, [candidateId]);

  if (!dimensions) return null;

  return (
    <div className="space-y-2.5">
      {dimensions.map((d) => (
        <div key={d.label}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-500">{d.label}</span>
            <span className="text-xs font-semibold text-[#1C1B1A] tabular-nums">{d.score}/100</span>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100">
            <div className="h-2 rounded-full bg-[#FE6E3E] transition-all" style={{ width: `${Math.min(d.score, 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ReputationSection() {
  const [rep, setRep] = useState<ReputationData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/reputation");
        const data = await res.json();
        if (res.ok) setRep(data);
      } catch { /* silent */ }
      setLoaded(true);
    }
    load();
  }, []);

  if (!loaded || !rep || rep.totalScore === 0) return null;

  const tierStyle = rep.tier ? TIER_COLORS[rep.tier] : null;

  return (
    <div className="mb-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Reputation Score</h2>
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        {/* Header with score + tier */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-3xl font-bold text-[#1C1B1A]">{rep.totalScore}<span className="text-lg font-normal text-gray-400">/100</span></p>
            {rep.tier && tierStyle && (
              <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${tierStyle.bg} ${tierStyle.text}`}>
                {rep.tier}
              </span>
            )}
          </div>
          {rep.percentile && (
            <div className="text-right">
              <p className="text-sm font-semibold text-[#FE6E3E]">Top {100 - rep.percentile + 1}%</p>
              <p className="text-xs text-gray-400">of StaffVA professionals</p>
            </div>
          )}
        </div>

        {/* Breakdown bars */}
        <div className="mt-5 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">AI Assessment (40%)</span>
              <span className="text-xs font-semibold text-[#1C1B1A] tabular-nums">{rep.aiContribution} pts</span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-100">
              <div className="h-2 rounded-full bg-[#FE6E3E]" style={{ width: `${Math.min((rep.aiContribution / 40) * 100, 100)}%` }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">Client Reviews (40%)</span>
              <span className="text-xs font-semibold text-[#1C1B1A] tabular-nums">{rep.reviewContribution} pts</span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-100">
              <div className="h-2 rounded-full bg-amber-500" style={{ width: `${Math.min((rep.reviewContribution / 40) * 100, 100)}%` }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">Profile Completeness (20%)</span>
              <span className="text-xs font-semibold text-[#1C1B1A] tabular-nums">{rep.completenessContribution} pts</span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-100">
              <div className="h-2 rounded-full bg-green-500" style={{ width: `${Math.min((rep.completenessContribution / 20) * 100, 100)}%` }} />
            </div>
          </div>
        </div>

        <p className="mt-4 text-[11px] text-gray-400">
          Score updates daily. Improve by completing your AI interview, earning client reviews, and filling out your profile.
        </p>
      </div>
    </div>
  );
}

function PayoutSetupCard({ payoutStatus }: { payoutStatus: string | null }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = payoutStatus || "not_setup";

  async function handleSetup() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/connect/create-account", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Something went wrong. Please try again."); return; }
      window.location.href = data.url;
    } catch {
      setError("Unable to connect to Stripe. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResolve() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/connect/login-link", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Something went wrong. Please try again."); return; }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch {
      setError("Unable to open Stripe dashboard. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (status === "active") {
    return (
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-5 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500">
          <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-green-800">Payouts active</p>
          <p className="text-xs text-green-700">Your payments will be sent automatically when escrow releases.</p>
        </div>
      </div>
    );
  }

  if (status === "suspended") {
    return (
      <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-5">
        <p className="text-sm font-semibold text-red-800">Your payout account needs attention</p>
        <p className="mt-1 text-xs text-red-700">Stripe has flagged your payout account. Please resolve the issue to continue receiving payments.</p>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <button
          onClick={handleResolve}
          disabled={loading}
          className="mt-3 inline-block rounded-full bg-red-600 px-5 py-2 text-xs font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          {loading ? "Opening…" : "Resolve Issue"}
        </button>
      </div>
    );
  }

  if (status === "onboarding") {
    return (
      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
        <p className="text-sm font-semibold text-amber-800">Your payout account setup is incomplete</p>
        <p className="mt-1 text-xs text-amber-700">Finish setting up your Stripe Express account to receive payments when escrow releases.</p>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <button
          onClick={handleSetup}
          disabled={loading}
          className="mt-3 inline-block rounded-full bg-amber-500 px-5 py-2 text-xs font-semibold text-white hover:bg-amber-600 transition-colors disabled:opacity-50"
        >
          {loading ? "Loading…" : "Continue Setup"}
        </button>
        <p className="mt-2 text-[11px] text-amber-600">Transfer fees are deducted from your payout by Stripe. Your agreed rate is what clients pay — fees come from your side.</p>
      </div>
    );
  }

  // not_setup (default)
  return (
    <div className="mb-6 rounded-xl border border-orange-200 bg-orange-50 p-5">
      <p className="text-sm font-semibold text-orange-800">Set up your payout account to receive payments</p>
      <p className="mt-1 text-xs text-orange-700">Connect your bank account through Stripe Express to automatically receive funds when your escrow releases.</p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <button
        onClick={handleSetup}
        disabled={loading}
        className="mt-3 inline-block rounded-full bg-[#FE6E3E] px-5 py-2 text-xs font-semibold text-white hover:bg-[#E55A2B] transition-colors disabled:opacity-50"
      >
        {loading ? "Loading…" : "Set Up Payouts"}
      </button>
      <p className="mt-2 text-[11px] text-orange-600">Transfer fees are deducted from your payout by Stripe. Your agreed rate is what clients pay — fees come from your side.</p>
    </div>
  );
}

export default function CandidateDashboardPage() {
  const [candidate, setCandidate] = useState<CandidateData | null>(null);
  const [viewStats, setViewStats] = useState<ViewStats | null>(null);
  const [interviews, setInterviews] = useState<InterviewData[]>([]);
  const [aiInterview, setAiInterview] = useState<AIInterviewData | null>(null);
  const [retakeData, setRetakeData] = useState<RetakeData | null>(null);
  const [hasPortfolio, setHasPortfolio] = useState(false);
  const [changeRequests, setChangeRequests] = useState<{ area: string; instruction: string }[]>([]);
  const [recruiterProfile, setRecruiterProfile] = useState<{ full_name: string; calendar_link: string | null; recruiter_photo_url: string | null } | null>(null);
  const [recruiterUnread, setRecruiterUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [interviewError, setInterviewError] = useState<string | null>(null);

  async function handleInterviewClick() {
    setInterviewLoading(true);
    setInterviewError(null);
    try {
      const res = await fetch("/api/interview/token");
      if (!res.ok) throw new Error("Token request failed");
      const { token } = await res.json();
      window.open(`https://interview.staffva.com?token=${token}`, "_blank", "noopener,noreferrer");
    } catch {
      setInterviewError("Unable to start the interview. Please try again.");
    } finally {
      setInterviewLoading(false);
    }
  }
  const router = useRouter();
  const aiDoneRef = useRef(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: c, error: candidateError } = await supabase
        .from("candidates")
        .select("*")
        .eq("user_id", session.user.id)
        .single();

      if (candidateError) {
        console.error("[DASHBOARD] Candidate query failed:", candidateError.message, candidateError.code, candidateError.details);
        // PGRST116 = "no rows returned" from .single() — means no candidate record exists
        if (candidateError.code === "PGRST116") {
          // Legitimate: user has no candidate record, send to application
          router.replace("/apply");
          return;
        }
        // Any other error (column doesn't exist, permission error, etc.) — show error, don't redirect
        setLoadError(`Unable to load your profile (${candidateError.code}). Please refresh the page.`);
        setLoading(false);
        return;
      }

      if (c) {
        setCandidate(c as CandidateData);

        // Check portfolio
        const { count } = await supabase
          .from("portfolio_items")
          .select("*", { count: "exact", head: true })
          .eq("candidate_id", c.id);
        setHasPortfolio((count || 0) > 0);

        // Load interviews (legacy)
        const { data: interviewData } = await supabase
          .from("candidate_interviews")
          .select("interview_number, status, communication_score, demeanor_score, role_knowledge_score")
          .eq("candidate_id", c.id);
        if (interviewData) setInterviews(interviewData as InterviewData[]);

        // Load AI interview (new system)
        const { data: aiData } = await supabase
          .from("ai_interviews")
          .select("id, status, overall_score, badge_level, passed, created_at, completed_at, second_interview_status")
          .eq("candidate_id", c.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (aiData) setAiInterview(aiData as AIInterviewData);

        // Load retake data
        const { data: retake } = await supabase
          .from("interview_attempts")
          .select("next_retake_available_at, attempt_number")
          .eq("candidate_id", c.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (retake) setRetakeData(retake as RetakeData);
      }

      // Load pending change requests
      if (c && c.admin_status === "changes_requested") {
        const { data: cr } = await supabase
          .from("candidate_change_requests")
          .select("change_items")
          .eq("candidate_id", c!.id)
          .eq("status", "pending")
          .order("submitted_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cr?.change_items && Array.isArray(cr.change_items)) {
          setChangeRequests(cr.change_items as { area: string; instruction: string }[]);
        }
      }

      // Load recruiter profile if assigned — via API (service role bypasses profiles RLS)
      if (c && c.assigned_recruiter) {
        try {
          const rpRes = await fetch("/api/candidate/recruiter-profile", {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (rpRes.ok) {
            const rpData = await rpRes.json();
            if (rpData.recruiter_profile) setRecruiterProfile(rpData.recruiter_profile);
          }
        } catch { /* silent — recruiter card just won't show */ }

        // Count unread recruiter messages
        const { count: unread } = await supabase
          .from("recruiter_messages")
          .select("*", { count: "exact", head: true })
          .eq("candidate_id", c.id)
          .eq("sender_role", "recruiter")
          .is("read_at", null);
        setRecruiterUnread(unread || 0);
      }

      try {
        const res = await fetch("/api/profile-views", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const stats = await res.json();
          setViewStats(stats);
        }
      } catch { /* silent */ }

      setLoading(false);
    }
    load();

    // Re-fetch when window regains focus (candidate returns from Stripe onboarding or interview)
    function handleFocus() { load(); }
    window.addEventListener("focus", handleFocus);

    // Trigger immediate reload if returning from Stripe Connect onboarding
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const payoutParam = params.get("payout");
      if (payoutParam === "complete" || payoutParam === "refresh") {
        // Clean the URL param then reload data
        const url = new URL(window.location.href);
        url.searchParams.delete("payout");
        window.history.replaceState({}, "", url.toString());
        load();
      }
    }

    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  // Poll for AI interview completion when it's the expected next step
  useEffect(() => {
    if (!candidate) return;
    const idVerified = candidate.id_verification_status === "passed";
    const testDone = (candidate.english_mc_score ?? 0) > 0;
    const aiDone = !!candidate.ai_interview_completed_at;

    // Only poll if ID verified, test done, and AI not yet done
    if (!idVerified || !testDone || aiDone) return;

    aiDoneRef.current = false;
    let attempts = 0;
    const maxAttempts = 12; // 6 minutes (every 30s)

    const pollInterval = setInterval(async () => {
      if (aiDoneRef.current) { clearInterval(pollInterval); return; }
      attempts++;
      if (attempts > maxAttempts) { clearInterval(pollInterval); return; }

      try {
        const supabase = createClient();
        const { data: aiData } = await supabase
          .from("ai_interviews")
          .select("id, status, overall_score, badge_level, passed, created_at, completed_at, second_interview_status")
          .eq("candidate_id", candidate.id)
          .eq("status", "completed")
          .eq("passed", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (aiData) {
          aiDoneRef.current = true;
          setAiInterview(aiData as AIInterviewData);
          clearInterval(pollInterval);
        }
      } catch { /* silent */ }
    }, 30000);

    return () => clearInterval(pollInterval);
  }, [candidate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-sm text-red-600 font-medium">{loadError}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-[#FE6E3E] px-5 py-2 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors"
        >
          Refresh Page
        </button>
      </div>
    );
  }

  if (!candidate) {
    // This only runs if loading finished with no error and no candidate — should not happen
    // since PGRST116 (no rows) now redirects in the useEffect. Safety fallback only.
    router.replace("/apply");
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" />
      </div>
    );
  }

  // Anti-cheat lockout — replace dashboard entirely
  if (candidate.test_lockout_until && new Date(candidate.test_lockout_until) > new Date()) {
    const unlockDate = new Date(candidate.test_lockout_until);
    const msRemaining = unlockDate.getTime() - Date.now();
    const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
    const formattedDate = unlockDate.toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="mx-auto max-w-md text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-[#1C1B1A]">Your assessment is currently paused</h1>
            <p className="mt-4 text-sm leading-relaxed text-gray-500">
              You left the test screen during your English assessment, which is not permitted.
            </p>
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-6 py-5">
              <p className="text-sm text-gray-700">
                You may return on <strong className="text-[#1C1B1A]">{formattedDate}</strong>.
                When you return your assessment will restart from the beginning.
              </p>
              <p className="mt-3 text-2xl font-bold text-red-600">
                {daysRemaining} {daysRemaining === 1 ? "day" : "days"} remaining
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const statusConfig: Record<string, { label: string; color: string; bgColor: string }> = {
    active: { label: "In Pipeline", color: "text-blue-700", bgColor: "bg-blue-50 border-blue-200" },
    profile_review: { label: "Under Review", color: "text-yellow-700", bgColor: "bg-yellow-50 border-yellow-200" },
    pending_2nd_interview: { label: "Pending 2nd Interview", color: "text-blue-700", bgColor: "bg-blue-50 border-blue-200" },
    pending_review: { label: "Pending Review", color: "text-yellow-700", bgColor: "bg-yellow-50 border-yellow-200" },
    approved: { label: "Live", color: "text-green-700", bgColor: "bg-green-50 border-green-200" },
    rejected: { label: "Not Approved", color: "text-red-700", bgColor: "bg-red-50 border-red-200" },
    revision_required: { label: "Revision Needed", color: "text-orange-700", bgColor: "bg-orange-50 border-orange-200" },
    deactivated: { label: "Deactivated", color: "text-gray-700", bgColor: "bg-gray-50 border-gray-200" },
  };

  const status = statusConfig[candidate.admin_status] || statusConfig.active;
  const { score: completenessScore, items: completenessItems } = calculateCompleteness(candidate, hasPortfolio);
  const nextTip = completenessItems.find((item) => !item.complete);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-gray-100">
          {candidate.profile_photo_url ? (
            <img src={candidate.profile_photo_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xl font-bold text-gray-400">
              {candidate.display_name?.charAt(0) || "?"}
            </div>
          )}
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#1C1B1A]">
            Welcome back, {candidate.display_name?.split(" ")[0] || "there"}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${status.bgColor} ${status.color}`}>
              {status.label}
            </span>
            <span className="text-sm text-gray-500">{candidate.role_category}</span>
          </div>
        </div>
      </div>

      {/* ═══ PROGRESS TRACKER + NEXT STEP (9-stage pipeline) ═══ */}
      {(() => {
        // Derive stage from actual DB fields — each step reads directly from its completion field
        const step1Done = true; // Candidate record exists
        const step2Done = (candidate.english_mc_score ?? 0) >= 70 && (candidate.english_comprehension_score ?? 0) >= 70 && !!candidate.voice_recording_1_url && !!candidate.voice_recording_2_url;
        const step3Done = candidate.id_verification_status === "passed";
        const step4Done = !!candidate.profile_photo_url && !!candidate.resume_url && !!candidate.tagline && !!candidate.bio && !!candidate.payout_method && !!candidate.interview_consent_at;

        // AI interview fail-gate derived state — interview_attempts.next_retake_available_at
        // is the single source of truth for retake timing.
        const aiFailed = candidate.admin_status === "ai_interview_failed";
        const retakeAt = retakeData?.next_retake_available_at
          ? new Date(retakeData.next_retake_available_at)
          : null;
        const retakeAvailable = retakeAt ? retakeAt <= new Date() : false;

        // Step 5 is only "done" if the interview completed AND did not fail — a failed
        // interview blocks progress past Step 4 until the candidate retakes and passes.
        const step5Done = !!candidate.ai_interview_completed_at && !aiFailed;
        const step6Done = candidate.second_interview_status === "completed";
        const step7Done = candidate.admin_status === "approved";

        // Derived flags for 9-stage message card logic
        const testSubmitted = (candidate.english_mc_score ?? 0) > 0;
        const idConsentGiven = !!candidate.id_verification_consent;
        const idVerified = step3Done;
        const idManualReview = candidate.id_verification_status === "manual_review";
        const aiDone = step5Done;
        const recruiterScheduled = candidate.second_interview_status === "scheduled";
        const recruiterDone = step6Done;
        const spokenScored = (candidate.spoken_english_score ?? 0) > 0;
        const profileUnderReview = recruiterDone && spokenScored && !step7Done && candidate.admin_status !== "changes_requested";
        const changesRequested = candidate.admin_status === "changes_requested";
        const profileLive = step7Done;

        const aiStageLabel = aiFailed
          ? (retakeAvailable ? "Retake Ready" : "Interview Failed")
          : "AI Interview";
        const aiStageState: StageState = aiFailed
          ? (retakeAvailable ? "retake-ready" : "failed")
          : undefined;

        const stages: { label: string; done: boolean; state?: StageState }[] = [
          { label: "Application", done: step1Done },
          { label: "English Test", done: step2Done },
          { label: "ID Verified", done: step3Done },
          { label: "Profile", done: step4Done },
          { label: aiStageLabel, done: step5Done, state: aiStageState },
          { label: "Recruiter", done: step6Done },
          { label: "Live", done: step7Done },
        ];

        let currentIndex = stages.findIndex((s) => !s.done);
        if (currentIndex === -1) currentIndex = stages.length;

        const completedCount = stages.filter((s) => s.done).length;
        const progressPercent = Math.round((completedCount / stages.length) * 100);
        const currentStageName = currentIndex < stages.length ? stages[currentIndex].label : "Complete";

        // Determine which of the 9 message stages we're in
        let nextHeading = "";
        let nextBody = "";
        let nextHref = "";
        let nextLabel = "";
        let isInterviewButton = false;
        let retakeDisabledLabel = "";

        if (!testSubmitted) {
          // Stage 1: English test not started
          nextHeading = "Your application is received";
          nextBody = "Your English assessment is ready when you are.";
          nextHref = "/apply"; nextLabel = "Start Assessment";
        } else if (testSubmitted && !idConsentGiven && !idVerified) {
          // Stage 2: Test submitted, awaiting ID verification
          nextHeading = "Your assessment has been submitted";
          nextBody = "Complete your identity verification to see your results.";
          nextHref = "/apply"; nextLabel = "Verify My Identity";
        } else if (idManualReview && !idVerified) {
          // Stage 3: ID verification pending manual review
          nextHeading = "Your identity is being reviewed by our team";
          nextBody = "You will receive your results by email within 48 hours.";
        } else if (idVerified && !aiDone) {
          // Stage 4: ID verified, AI interview not started / failed / retake ready
          const aiInProgress = !!aiInterview && aiInterview.status === "in_progress";
          const score = aiInterview?.overall_score ?? 0;
          const retakeDateFormatted = retakeAt
            ? retakeAt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
            : "";

          if (aiFailed && !retakeAvailable) {
            // State A — failed, retake not yet available
            nextHeading = "Your AI interview did not pass";
            nextBody = `Your AI interview score was ${score} out of 100. You need 60 or above to continue. Your retake will be available on ${retakeDateFormatted}.`;
            retakeDisabledLabel = retakeDateFormatted ? `Retake Available ${retakeDateFormatted}` : "Retake Available Soon";
          } else if (aiFailed && retakeAvailable) {
            // State B — failed, retake now available
            nextHeading = "Your retake is ready";
            nextBody = `You scored ${score} on your first attempt. You need 60 or above to proceed.`;
            isInterviewButton = true;
            nextLabel = "Start AI Interview";
          } else if (aiInProgress) {
            nextHeading = "Your AI interview is in progress";
            nextBody = "Complete your interview to move to the next step.";
            isInterviewButton = true;
            nextLabel = "Continue Interview";
          } else {
            nextHeading = "Your English test results are ready";
            nextBody = "Complete your AI interview to continue.";
            isInterviewButton = true;
            nextLabel = "Start AI Interview";
          }
        } else if (aiDone && !recruiterScheduled && !recruiterDone) {
          // Stage 5: AI interview complete, awaiting recruiter
          if (recruiterProfile) {
            nextHeading = "Meet your StaffVA Talent Specialist";
            nextBody = "";
          } else {
            nextHeading = "Your AI interview is complete";
            nextBody = "A Talent Specialist will be assigned to you shortly to schedule your second interview.";
          }
        } else if (recruiterScheduled && !recruiterDone) {
          // Stage 6: Recruiter interview scheduled
          nextHeading = "Your Talent Specialist interview is scheduled";
          nextBody = "Check your email for the details.";
        } else if (profileUnderReview) {
          // Stage 7: Recruiter interview complete + spoken scored, under review
          nextHeading = "Your profile is under review";
          nextBody = "Our team is carefully reviewing your profile, voice recordings, and experience. We will be in touch soon.";
        } else if (changesRequested) {
          // Stage 8: Recruiter requested changes
          nextHeading = "Your reviewer has requested some updates";
          nextBody = "Your profile needs a few updates before it can go live. See the requested changes below and resubmit when ready.";
          nextHref = "/apply"; nextLabel = "Update My Profile";
        } else if (profileLive) {
          // Stage 9: Profile live
          nextHeading = "Your profile is live";
          nextBody = "Clients can find you right now.";
          nextHref = `/candidate/${candidate.id}`; nextLabel = "View My Profile";
        } else if (recruiterDone && !spokenScored) {
          // Recruiter done but spoken not scored yet — waiting
          nextHeading = "Your Talent Specialist interview is complete";
          nextBody = "Our team is processing your results. We will be in touch soon.";
        } else {
          // Fallback
          nextHeading = "Continue your application";
          nextBody = "Complete the next step to move forward.";
          nextHref = "/apply"; nextLabel = "Continue";
        }

        return (
          <div className="mb-8">
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              {/* Desktop: full horizontal tracker */}
              <div className="hidden sm:flex items-center justify-between">
                {stages.map((stage, i) => (
                  <div key={stage.label} className="flex items-center">
                    <div className="flex flex-col items-center">
                      {stage.state === "failed" ? (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500">
                          <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </div>
                      ) : stage.state === "retake-ready" ? (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-400 ring-2 ring-amber-500">
                          <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
                        </div>
                      ) : stage.done ? (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500">
                          <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                        </div>
                      ) : i === currentIndex ? (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FE6E3E]/20 ring-2 ring-[#FE6E3E]">
                          <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#FE6E3E]" />
                        </div>
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100">
                          <div className="h-2 w-2 rounded-full bg-gray-300" />
                        </div>
                      )}
                      <span className={`mt-1.5 text-[9px] font-medium text-center leading-tight ${stage.state === "failed" ? "text-red-600" : stage.state === "retake-ready" ? "text-amber-600" : stage.done ? "text-green-600" : i === currentIndex ? "text-[#1C1B1A]" : "text-gray-400"}`}>{stage.label}</span>
                    </div>
                    {i < stages.length - 1 && (
                      <div className={`mx-1 h-0.5 w-6 lg:w-12 ${stage.done ? "bg-green-400" : "bg-gray-200"}`} />
                    )}
                  </div>
                ))}
              </div>

              {/* Mobile: collapsed view */}
              <MobileProgressTracker
                currentIndex={currentIndex}
                currentStageName={currentStageName}
                progressPercent={progressPercent}
                stages={stages}
              />
            </div>
            <div className="mt-3 rounded-xl border border-[#FE6E3E]/20 bg-[#FE6E3E]/5 p-5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#FE6E3E]">What to do next</p>
              <h3 className="mt-1 text-lg font-semibold text-[#1C1B1A]">{nextHeading}</h3>
              {nextBody && <p className="mt-1 text-sm text-gray-500">{nextBody}</p>}

              {/* Recruiter intro card — Step 5 */}
              {recruiterProfile && aiDone && !recruiterScheduled && !recruiterDone && (
                <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
                  <div className="flex items-start gap-4">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-gray-100">
                      {recruiterProfile.recruiter_photo_url ? (
                        <img src={recruiterProfile.recruiter_photo_url} alt={recruiterProfile.full_name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-lg font-bold text-gray-400">
                          {recruiterProfile.full_name?.charAt(0) || "R"}
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-[#1C1B1A]">{recruiterProfile.full_name}</p>
                      <p className="mt-1 text-sm text-gray-500">
                        Hi {candidate.display_name?.split(" ")[0] || "there"}, I reviewed your application and I am excited to connect. Book a time below for your second interview.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {candidate.role_category === "Other" && !candidate.assigned_recruiter ? (
                          <div className="w-full rounded-lg bg-amber-50 border border-amber-200 p-3">
                            <p className="text-xs text-amber-800 font-medium">Your Talent Specialist will be assigned within 24 hours. You will be notified when this happens.</p>
                          </div>
                        ) : (
                          <>
                            {recruiterProfile.calendar_link ? (
                              <a
                                href={recruiterProfile.calendar_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-full bg-[#FE6E3E] px-5 py-2 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors"
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                                </svg>
                                Schedule My Interview
                              </a>
                            ) : (
                              <p className="text-xs text-gray-400 italic">Your Talent Specialist will reach out to schedule your second interview shortly.</p>
                            )}
                            <Link
                              href={`/candidate/dashboard/recruiter-chat`}
                              className="relative inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-5 py-2 text-sm font-semibold text-[#1C1B1A] hover:bg-gray-50 transition-colors"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                              </svg>
                              Message {recruiterProfile.full_name?.split(" ")[0] || "Talent Specialist"}
                              {recruiterUnread > 0 && (
                                <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#FE6E3E] text-[10px] font-bold text-white">
                                  {recruiterUnread}
                                </span>
                              )}
                            </Link>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Change requests list for Stage 8 */}
              {changesRequested && changeRequests.length > 0 && (
                <div className="mt-3 space-y-2">
                  {changeRequests.map((cr, idx) => (
                    <div key={idx} className="rounded-lg bg-white border border-gray-200 px-3 py-2">
                      <p className="text-xs font-semibold text-[#1C1B1A]">{cr.area}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{cr.instruction}</p>
                    </div>
                  ))}
                </div>
              )}

              {isInterviewButton && nextLabel && (
                <div className="mt-3">
                  <button
                    onClick={handleInterviewClick}
                    disabled={interviewLoading}
                    className="inline-block rounded-full bg-[#FE6E3E] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors disabled:opacity-60"
                  >
                    {interviewLoading ? "Loading…" : nextLabel}
                  </button>
                  {interviewError && (
                    <p className="mt-2 text-sm text-red-600">{interviewError}</p>
                  )}
                </div>
              )}
              {retakeDisabledLabel && (
                <div className="mt-3">
                  <button
                    disabled
                    className="inline-block rounded-full bg-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-400 cursor-not-allowed"
                  >
                    {retakeDisabledLabel}
                  </button>
                </div>
              )}
              {!isInterviewButton && nextHref && nextLabel && (
                <a href={nextHref} target={nextHref.startsWith("http") ? "_blank" : undefined} rel={nextHref.startsWith("http") ? "noopener noreferrer" : undefined} className="mt-3 inline-block rounded-full bg-[#FE6E3E] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors">
                  {nextLabel}
                </a>
              )}
            </div>
          </div>
        );
      })()}

      {/* Old next step action button removed — replaced by "What to do next" card above */}

      {/* Old vertical progress tracker removed — replaced by horizontal tracker above */}

      {/* Lockout card */}
      <LockoutCard />

      {/* Status messages — handled by progress tracker above */}
      {candidate.admin_status === "revision_required" && (
        <div className="mb-6 rounded-lg border border-orange-200 bg-orange-50 p-4">
          <p className="text-sm font-medium text-orange-800">Action required</p>
          <p className="mt-1 text-sm text-orange-700">Our team has reviewed your profile and left feedback. Check your email for details on what to update.</p>
          <Link href="/apply" className="mt-2 inline-block text-sm font-medium text-[#FE6E3E] hover:underline">Edit my profile →</Link>
        </div>
      )}
      {candidate.id_verification_status === "manual_review" && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <svg className="h-5 w-5 shrink-0 text-amber-600 mt-0.5 animate-pulse" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-amber-800">ID Verification Under Review</p>
              <p className="mt-1 text-sm text-amber-700">Your identity verification is being manually reviewed. This typically takes up to 48 hours. We will email you once resolved. You can continue viewing your application progress while you wait.</p>
            </div>
          </div>
        </div>
      )}
      {candidate.id_verification_status === "failed" && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <svg className="h-5 w-5 shrink-0 text-red-600 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-red-800">ID Verification Failed</p>
              <p className="mt-1 text-sm text-red-700">Your identity verification could not be completed. Your application is paused. Please contact support if you believe this is an error.</p>
              <a href="mailto:support@staffva.com" className="mt-2 inline-block text-sm font-medium text-[#FE6E3E] hover:underline">Contact support →</a>
            </div>
          </div>
        </div>
      )}

      {/* Profile Completeness */}
      <div className="mb-8 rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Profile Completeness</h2>
          <span className={`text-lg font-bold ${completenessScore === 100 ? "text-green-600" : completenessScore >= 70 ? "text-[#FE6E3E]" : "text-yellow-600"}`}>
            {completenessScore}%
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${completenessScore === 100 ? "bg-green-500" : "bg-[#FE6E3E]"}`}
            style={{ width: `${completenessScore}%` }}
          />
        </div>

        {/* Next tip */}
        {nextTip && completenessScore < 100 && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-orange-50 border border-orange-100 px-3 py-2">
            <svg className="h-4 w-4 shrink-0 text-[#FE6E3E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-[#1C1B1A]">
              <span className="font-medium">Next step (+{nextTip.points}%):</span>{" "}
              {nextTip.tip}
            </p>
            <Link href={nextTip.link} className="ml-auto shrink-0 text-xs font-medium text-[#FE6E3E] hover:underline">
              Complete →
            </Link>
          </div>
        )}

        {completenessScore === 100 && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-green-50 border border-green-100 px-3 py-2">
            <svg className="h-4 w-4 shrink-0 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-xs text-green-700 font-medium">Your profile is 100% complete. You&apos;re maximizing your visibility to clients.</p>
          </div>
        )}

        {/* Checklist */}
        <div className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {completenessItems.map((item) => (
            <div key={item.label} className="flex items-center gap-2 text-sm">
              {item.complete ? (
                <svg className="h-4 w-4 shrink-0 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <div className="h-4 w-4 shrink-0 rounded-full border-2 border-gray-300" />
              )}
              <span className={item.complete ? "text-gray-500 line-through" : "text-[#1C1B1A]"}>
                {item.label}
              </span>
              <span className="text-xs text-gray-400">+{item.points}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* AI Interview Results — visible to candidate only */}
      {aiInterview && aiInterview.status === "completed" && (
        <div className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">AI Interview Results</h2>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-3xl font-bold text-[#1C1B1A]">{aiInterview.overall_score}<span className="text-lg font-normal text-gray-400">/100</span></p>
                {aiInterview.passed ? (
                  <span className="mt-1 inline-block rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">Passed</span>
                ) : (
                  <span className="mt-1 inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">Did Not Pass</span>
                )}
              </div>
              {aiInterview.completed_at && (
                <p className="text-xs text-gray-400">Completed {new Date(aiInterview.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
              )}
            </div>

            {/* Dimension scores — fetched inline */}
            <AIInterviewDimensions candidateId={candidate.id} />
          </div>
        </div>
      )}

      {/* Profile Activity */}
      <div className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Profile Activity</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Stat cards */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Views This Week</p>
            <p className="mt-1 text-3xl font-bold text-[#1C1B1A]">{viewStats?.weekViews || 0}</p>
            <p className="mt-1 text-xs text-gray-400">{viewStats?.monthViews || 0} this month</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Total Views</p>
            <p className="mt-1 text-3xl font-bold text-[#1C1B1A]">{viewStats?.totalViews || 0}</p>
            <p className="mt-1 text-xs text-gray-400">All time</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Earnings</p>
            <p className="mt-1 text-3xl font-bold text-green-600">${(candidate.total_earnings_usd || 0).toLocaleString()}</p>
            <p className="mt-1 text-xs text-gray-400">Platform total</p>
          </div>
        </div>

        {/* Daily views bar chart */}
        {viewStats?.dailyCounts && viewStats.dailyCounts.length > 0 && (
          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-3">Views by Day — Past 7 Days</p>
            <div className="flex items-end gap-2 h-16">
              {viewStats.dailyCounts.map((d) => {
                const maxCount = Math.max(...(viewStats.dailyCounts || []).map((dc) => dc.count), 1);
                const height = d.count > 0 ? Math.max((d.count / maxCount) * 100, 12) : 4;
                return (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] font-semibold text-[#1C1B1A] tabular-nums">{d.count > 0 ? d.count : ""}</span>
                    <div
                      className={`w-full rounded-sm transition-all ${d.count > 0 ? "bg-[#FE6E3E]" : "bg-gray-100"}`}
                      style={{ height: `${height}%` }}
                    />
                    <span className="text-[9px] text-gray-400">{d.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Reputation Score */}
      <ReputationSection />

      {/* Escrow Status */}
      <div className="mb-6">
        <EscrowStatusPanel role="candidate" />
      </div>

      {/* Payout Setup */}
      <PayoutSetupCard payoutStatus={candidate.payout_status} />

      {/* Contracts */}
      <ContractsSection />

      {/* Video Introduction */}
      {candidate.video_intro_status === "approved" ? (
        <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-5">
          <div className="flex items-center gap-2 mb-2">
            <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-sm font-semibold text-green-800">Your video introduction is live</h3>
          </div>
          <p className="text-xs text-green-700 mb-3">Clients can watch it on your profile.</p>
        </div>
      ) : candidate.video_intro_status === "pending_review" ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
            <h3 className="text-sm font-semibold text-amber-800">Your video introduction is under review</h3>
          </div>
          <p className="mt-1 text-xs text-amber-700">We will notify you within 24 hours.</p>
        </div>
      ) : candidate.video_intro_status === "revision_required" ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h3 className="text-sm font-semibold text-amber-800">Your video needs a small update</h3>
          {candidate.video_intro_admin_note && (
            <div className="mt-2 rounded-lg bg-white border border-amber-200 p-3">
              <p className="text-xs text-amber-900 italic">&quot;{candidate.video_intro_admin_note}&quot;</p>
            </div>
          )}
          <Link
            href="/profile/video-intro"
            className="mt-3 inline-block rounded-full bg-[#FE6E3E] px-5 py-2 text-xs font-semibold text-white hover:bg-[#e55a2b] transition-colors"
          >
            Re-record Video
          </Link>
        </div>
      ) : (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#1C1B1A]">Add Your Video Introduction</h3>
              <p className="mt-0.5 text-xs text-gray-500">Candidates with a video introduction attract significantly more client attention. Add yours to earn 3 bonus raffle entries.</p>
              <Link
                href="/profile/video-intro"
                className="mt-3 inline-block rounded-full bg-[#FE6E3E] px-5 py-2 text-xs font-semibold text-white hover:bg-[#e55a2b] transition-colors"
              >
                Add Video Introduction
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6">
        <GiveawayTracker />
      </div>

      {/* Quick actions */}
      <div className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Quick Actions</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Link href={`/candidate/${candidate.id}`} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 hover:shadow-sm transition-shadow">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-50 text-lg">👤</span>
            <div>
              <p className="text-sm font-semibold text-[#1C1B1A]">View My Profile</p>
              <p className="text-xs text-gray-500">See how clients see you</p>
            </div>
          </Link>
          <Link href="/apply" className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 hover:shadow-sm transition-shadow">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-lg">✏️</span>
            <div>
              <p className="text-sm font-semibold text-[#1C1B1A]">Edit Profile</p>
              <p className="text-xs text-gray-500">Update your info and skills</p>
            </div>
          </Link>
        </div>
      </div>

      {/* Profile details card */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Profile Summary</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Role</p>
            <p className="font-medium text-[#1C1B1A]">{candidate.role_category}</p>
          </div>
          <div>
            <p className="text-gray-500">Monthly Rate</p>
            <p className="font-medium text-[#FE6E3E]">${candidate.hourly_rate?.toLocaleString()}/hr</p>
          </div>
          <div>
            <p className="text-gray-500">Availability</p>
            <p className="font-medium text-[#1C1B1A] capitalize">{candidate.availability_status?.replace(/_/g, " ") || "Not set"}</p>
          </div>
          <div>
            <p className="text-gray-500">English Level</p>
            <p className="font-medium text-[#1C1B1A] capitalize">{candidate.english_written_tier || "Pending"}</p>
          </div>
          <div>
            <p className="text-gray-500">Verified Earnings</p>
            <p className="font-medium text-green-600">${(candidate.total_earnings_usd || 0).toLocaleString()}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
