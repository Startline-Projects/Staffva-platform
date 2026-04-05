"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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

type StepStatus = "completed" | "current" | "upcoming";

function getProgressSteps(c: CandidateData, interviews: InterviewData[], aiInterviewData: AIInterviewData | null, retake: RetakeData | null): { label: string; status: StepStatus; detail?: string }[] {
  // Determine completion state for each step based on actual data only
  const step1Done = true; // Candidate record exists = application submitted
  const step2Done = (c.english_mc_score ?? 0) > 0;
  const step3Done = c.id_verification_status === "passed" || !!c.voice_recording_1_url;
  const step4Done = !!c.profile_photo_url && !!c.resume_url;

  // Use AI interview data from ai_interviews table (new system)
  const step5Done = !!aiInterviewData && aiInterviewData.status === "completed" && aiInterviewData.passed;
  const step6Done = aiInterviewData?.second_interview_status === "completed";
  const step7Done = c.admin_status === "approved";

  function status(done: boolean, prevDone: boolean): StepStatus {
    if (done) return "completed";
    if (prevDone) return "current";
    return "upcoming";
  }

  const steps: { label: string; status: StepStatus; detail?: string }[] = [
    {
      label: "Application Submitted",
      status: "completed",
      detail: undefined,
    },
    {
      label: "English Assessment",
      status: status(step2Done, step1Done),
      detail: step2Done ? undefined : "Complete the English grammar and comprehension test",
    },
    {
      label: "ID Verification",
      status: status(step3Done, step2Done),
      detail: step3Done ? undefined : "Verify your identity",
    },
    {
      label: "Profile Builder",
      status: status(step4Done, step3Done),
      detail: step4Done ? undefined : "Complete your profile — photo, bio, experience, and resume",
    },
    {
      label: "AI First Interview",
      status: status(step5Done, step4Done),
      detail: (() => {
        if (step5Done && aiInterviewData) {
          return `Score: ${aiInterviewData.overall_score}/100 — ${aiInterviewData.badge_level?.charAt(0).toUpperCase()}${aiInterviewData.badge_level?.slice(1) || ""}`;
        }
        if (aiInterviewData && aiInterviewData.status === "completed" && !aiInterviewData.passed) {
          // Failed — check retake lockout
          if (retake?.next_retake_available_at) {
            const retakeDate = new Date(retake.next_retake_available_at);
            const now = new Date();
            if (retakeDate > now) {
              const days = Math.ceil((retakeDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              return `Score: ${aiInterviewData.overall_score}/100 — Retake available in ${days} day${days === 1 ? "" : "s"}`;
            }
            return `Score: ${aiInterviewData.overall_score}/100 — Retake available now`;
          }
          return `Score: ${aiInterviewData.overall_score}/100 — Did not pass`;
        }
        if (aiInterviewData && aiInterviewData.status === "in_progress") {
          return "Interview in progress";
        }
        if (step4Done) return "Start your AI-powered interview";
        return undefined;
      })(),
    },
    {
      label: "Second Interview",
      status: status(step6Done, step5Done),
      detail: (() => {
        if (step6Done) return "Second interview completed";
        if (aiInterviewData?.second_interview_status === "scheduled") return "Second interview scheduled — your recruiter will contact you";
        if (step5Done) return "Awaiting assignment by StaffVA team";
        return undefined;
      })(),
    },
    {
      label: "Profile Live",
      status: status(step7Done, step6Done),
      detail: step7Done ? "Your profile is visible to clients" : step6Done ? "Awaiting admin approval" : undefined,
    },
  ];

  return steps;
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

function MobileProgressTracker({ currentIndex, currentStageName, progressPercent, stages }: {
  currentIndex: number; currentStageName: string; progressPercent: number;
  stages: { label: string; done: boolean }[];
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
              {stage.done ? (
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
              <span className={`text-sm ${stage.done ? "text-green-600 font-medium" : i === currentIndex ? "text-[#1C1B1A] font-medium" : "text-gray-400"}`}>{stage.label}</span>
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

export default function CandidateDashboardPage() {
  const [candidate, setCandidate] = useState<CandidateData | null>(null);
  const [viewStats, setViewStats] = useState<ViewStats | null>(null);
  const [interviews, setInterviews] = useState<InterviewData[]>([]);
  const [aiInterview, setAiInterview] = useState<AIInterviewData | null>(null);
  const [retakeData, setRetakeData] = useState<RetakeData | null>(null);
  const [hasPortfolio, setHasPortfolio] = useState(false);
  const [changeRequests, setChangeRequests] = useState<{ area: string; instruction: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: c } = await supabase
        .from("candidates")
        .select("id, display_name, admin_status, role_category, hourly_rate, availability_status, total_earnings_usd, profile_photo_url, english_written_tier, speaking_level, tagline, bio, skills, tools, work_experience, resume_url, payout_method, english_mc_score, voice_recording_1_url, voice_recording_2_url, profile_completed_at, id_verification_status, id_verification_consent, application_step, video_intro_status, video_intro_url, video_intro_admin_note, spoken_english_score, spoken_english_result, results_display_unlocked, profile_went_live_at")
        .eq("user_id", session.user.id)
        .single();

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
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" />
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-[#1C1B1A]">No profile found</h1>
        <p className="mt-2 text-sm text-gray-500">Complete your application to see your dashboard.</p>
        <Link href="/apply" className="mt-4 inline-block rounded-lg bg-[#FE6E3E] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#E55A2B]">
          Start Application
        </Link>
      </div>
    );
  }

  const statusConfig: Record<string, { label: string; color: string; bgColor: string }> = {
    pending_speaking_review: { label: "Under Review", color: "text-yellow-700", bgColor: "bg-yellow-50 border-yellow-200" },
    approved: { label: "Live", color: "text-green-700", bgColor: "bg-green-50 border-green-200" },
    rejected: { label: "Not Approved", color: "text-red-700", bgColor: "bg-red-50 border-red-200" },
    revision_required: { label: "Revision Needed", color: "text-orange-700", bgColor: "bg-orange-50 border-orange-200" },
    deactivated: { label: "Deactivated", color: "text-gray-700", bgColor: "bg-gray-50 border-gray-200" },
  };

  const status = statusConfig[candidate.admin_status] || statusConfig.pending_speaking_review;
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
        // Derive stage from actual DB fields
        const testSubmitted = (candidate.english_mc_score ?? 0) > 0;
        const idConsentGiven = !!candidate.id_verification_consent;
        const idVerified = candidate.id_verification_status === "passed";
        const idManualReview = candidate.id_verification_status === "manual_review";
        const aiDone = !!aiInterview && aiInterview.status === "completed" && aiInterview.passed;
        const recruiterScheduled = aiInterview?.second_interview_status === "scheduled";
        const recruiterDone = aiInterview?.second_interview_status === "completed";
        const spokenScored = (candidate.spoken_english_score ?? 0) > 0;
        const profileUnderReview = recruiterDone && spokenScored && candidate.admin_status !== "approved" && candidate.admin_status !== "changes_requested";
        const changesRequested = candidate.admin_status === "changes_requested";
        const profileLive = candidate.admin_status === "approved";

        // 7-stage progress bar with correct completion conditions
        const englishTestDone = testSubmitted && !!candidate.results_display_unlocked;
        const recruiterInterviewDone = recruiterDone && spokenScored;
        const profileReviewDone = candidate.admin_status === "approved";
        const profileLiveConfirmed = profileLive && !!candidate.profile_went_live_at;

        const stages = [
          { label: "Application", done: true },
          { label: "English Test", done: englishTestDone },
          { label: "ID Verified", done: idVerified },
          { label: "AI Interview", done: aiDone },
          { label: "Recruiter", done: recruiterInterviewDone },
          { label: "Review", done: profileReviewDone },
          { label: "Live", done: profileLiveConfirmed },
        ];

        // Profile Review is active during both under_review and changes_requested
        const reviewIsActive = recruiterInterviewDone && !profileReviewDone &&
          (candidate.admin_status === "under_review" || changesRequested);

        let currentIndex = stages.findIndex((s) => !s.done);
        // Override: if review is active, force currentIndex to 5 (Review stage)
        if (reviewIsActive) currentIndex = 5;
        if (currentIndex === -1) currentIndex = stages.length;

        const completedCount = stages.filter((s) => s.done).length;
        const progressPercent = Math.round((completedCount / stages.length) * 100);
        const currentStageName = currentIndex < stages.length ? stages[currentIndex].label : "Complete";

        // Determine which of the 9 message stages we're in
        let nextHeading = "";
        let nextBody = "";
        let nextHref = "";
        let nextLabel = "";

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
          // Stage 4: ID verified, AI interview not started
          const aiFailed = !!aiInterview && aiInterview.status === "completed" && !aiInterview.passed;
          const aiInProgress = !!aiInterview && aiInterview.status === "in_progress";
          if (aiFailed) {
            nextHeading = "Your AI interview did not pass";
            nextBody = "Review your results below. You may be eligible to retake the interview.";
          } else if (aiInProgress) {
            nextHeading = "Your AI interview is in progress";
            nextBody = "Complete your interview to move to the next step.";
            nextHref = `https://interview.staffva.com?candidate=${candidate.id}`;
            nextLabel = "Continue Interview";
          } else {
            nextHeading = "Your English test results are ready";
            nextBody = "Complete your AI interview to continue.";
            nextHref = `https://interview.staffva.com?candidate=${candidate.id}`;
            nextLabel = "Start AI Interview";
          }
        } else if (aiDone && !recruiterScheduled && !recruiterDone) {
          // Stage 5: AI interview complete, awaiting recruiter
          nextHeading = "Your AI interview is complete";
          nextBody = "A recruiter will contact you within 48 hours to schedule your second interview.";
        } else if (recruiterScheduled && !recruiterDone) {
          // Stage 6: Recruiter interview scheduled
          nextHeading = "Your recruiter interview is scheduled";
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
          nextHeading = "Your recruiter interview is complete";
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
                      {stage.done ? (
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
                      <span className={`mt-1.5 text-[9px] font-medium text-center leading-tight ${stage.done ? "text-green-600" : i === currentIndex ? "text-[#1C1B1A]" : "text-gray-400"}`}>{stage.label}</span>
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
              <p className="mt-1 text-sm text-gray-500">{nextBody}</p>

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

              {nextHref && nextLabel && (
                <a href={nextHref} target={nextHref.startsWith("http") ? "_blank" : undefined} rel={nextHref.startsWith("http") ? "noopener noreferrer" : undefined} className="mt-3 inline-block rounded-full bg-[#FE6E3E] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors">
                  {nextLabel}
                </a>
              )}
            </div>
          </div>
        );
      })()}

      {/* Next Step Action Button */}
      {(() => {
        const hasPassedTest = (candidate.english_mc_score ?? 0) >= 70 && (candidate.english_written_tier !== null);
        const hasRecordings = !!candidate.voice_recording_1_url && !!candidate.voice_recording_2_url;
        const profileDone = !!candidate.profile_photo_url && !!candidate.resume_url;
        const aiDone = !!aiInterview && aiInterview.status === "completed" && aiInterview.passed;

        if (aiDone) return null; // No button needed — green badge shows in tracker

        let label = "";
        let href = "/apply";

        if (!hasPassedTest && !hasRecordings) {
          label = candidate.english_mc_score ? "Continue English Test" : "Continue Application";
        } else if (hasPassedTest && !hasRecordings) {
          label = "Continue Application";
        } else if (hasRecordings && !profileDone) {
          label = "Continue Profile Setup";
        } else if (profileDone && !aiDone) {
          // Check if retake is locked
          if (aiInterview && aiInterview.status === "completed" && !aiInterview.passed && retakeData?.next_retake_available_at) {
            const retakeDate = new Date(retakeData.next_retake_available_at);
            if (retakeDate > new Date()) {
              // Retake locked — don't show button
              label = "";
            } else {
              label = "Retake AI Interview";
              href = `https://interview.staffva.com?candidate=${candidate.id}`;
            }
          } else {
            label = "Start AI Interview";
            href = `https://interview.staffva.com?candidate=${candidate.id}`;
          }
        }

        if (!label) return null;

        return (
          <div className="mb-6">
            <a
              href={href}
              target={href.startsWith("http") ? "_blank" : undefined}
              rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
              className="inline-flex items-center gap-2 rounded-lg bg-[#FE6E3E] px-6 py-3 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors shadow-sm"
            >
              {label === "Start AI Interview" && (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
              {label} →
            </a>
          </div>
        );
      })()}

      {/* Progress Tracker */}
      {(() => {
        const steps = getProgressSteps(candidate, interviews, aiInterview, retakeData);
        const aiCompleted = !!aiInterview && aiInterview.status === "completed" && aiInterview.passed;
        const profileBuilderDone = !!candidate.profile_photo_url && !!candidate.resume_url;

        return (
          <div className="mb-8 rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Your Progress</h2>
            <div className="relative">
              {steps.map((step, i) => (
                <div key={step.label} className="flex items-start gap-3 pb-4 last:pb-0">
                  {/* Vertical line */}
                  <div className="flex flex-col items-center">
                    {step.status === "completed" ? (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-500">
                        <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    ) : step.status === "current" ? (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#FE6E3E] ring-4 ring-orange-100">
                        <span className="text-xs font-bold text-white">{i + 1}</span>
                      </div>
                    ) : (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-gray-200 bg-gray-50">
                        <span className="text-xs font-medium text-gray-400">{i + 1}</span>
                      </div>
                    )}
                    {i < steps.length - 1 && (
                      <div className={`mt-1 h-6 w-0.5 ${step.status === "completed" ? "bg-green-300" : "bg-gray-200"}`} />
                    )}
                  </div>

                  {/* Content */}
                  <div className="pt-0.5">
                    <p className={`text-sm font-medium ${
                      step.status === "completed" ? "text-green-700" : step.status === "current" ? "text-[#1C1B1A]" : "text-gray-400"
                    }`}>
                      {step.label}
                    </p>
                    {step.detail && (
                      <p className={`mt-0.5 text-xs ${step.status === "completed" ? "text-green-600" : step.status === "current" ? "text-gray-500" : "text-gray-400"}`}>
                        {step.detail}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* AI Interview Button */}
            {profileBuilderDone && !aiCompleted && !aiInterview && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <a
                  href={`https://interview.staffva.com?candidate=${candidate.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#FE6E3E] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Start AI Interview
                </a>
                <p className="mt-1.5 text-xs text-gray-500">20-minute AI-powered structured interview. Available now.</p>
              </div>
            )}

            {aiCompleted && aiInterview && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <div className="inline-flex items-center gap-2 rounded-full bg-green-50 border border-green-200 px-4 py-2">
                  <svg className="h-4 w-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm font-medium text-green-700">
                    AI Interview Complete — {aiInterview.overall_score}/100 — {aiInterview.badge_level?.charAt(0).toUpperCase()}{aiInterview.badge_level?.slice(1)}
                  </span>
                </div>
              </div>
            )}

            {aiInterview && aiInterview.status === "completed" && !aiInterview.passed && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 border border-amber-200 px-4 py-2">
                  <svg className="h-4 w-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <span className="text-sm font-medium text-amber-700">
                    Score: {aiInterview.overall_score}/100 — {retakeData?.next_retake_available_at && new Date(retakeData.next_retake_available_at) > new Date()
                      ? `Retake available in ${Math.ceil((new Date(retakeData.next_retake_available_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))} days`
                      : "Retake available"}
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Lockout card */}
      <LockoutCard />

      {/* Status messages */}
      {candidate.admin_status === "pending_speaking_review" && (
        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm font-medium text-yellow-800">Your profile is under review</p>
          <p className="mt-1 text-sm text-yellow-700">We will notify you within 2 business days once your speaking assessment is complete and your profile is live.</p>
        </div>
      )}
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
          {candidate.admin_status === "approved" && (
            <Link href="/services" className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 hover:shadow-sm transition-shadow">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50 text-lg">📦</span>
              <div>
                <p className="text-sm font-semibold text-[#1C1B1A]">My Services</p>
                <p className="text-xs text-gray-500">Manage service packages</p>
              </div>
            </Link>
          )}
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
            <p className="text-gray-500">Speaking Level</p>
            <p className="font-medium text-[#1C1B1A] capitalize">{candidate.speaking_level || "Pending review"}</p>
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
