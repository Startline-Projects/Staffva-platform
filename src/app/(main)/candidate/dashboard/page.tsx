"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface ViewStats {
  weekViews: number;
  monthViews: number;
  totalViews: number;
}

interface CandidateData {
  id: string;
  display_name: string;
  admin_status: string;
  role_category: string;
  monthly_rate: number;
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

export default function CandidateDashboardPage() {
  const [candidate, setCandidate] = useState<CandidateData | null>(null);
  const [viewStats, setViewStats] = useState<ViewStats | null>(null);
  const [hasPortfolio, setHasPortfolio] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: c } = await supabase
        .from("candidates")
        .select("id, display_name, admin_status, role_category, monthly_rate, availability_status, total_earnings_usd, profile_photo_url, english_written_tier, speaking_level, tagline, bio, skills, tools, work_experience, resume_url, payout_method")
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

      {/* Stats grid */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Views This Week</p>
          <p className="mt-1 text-2xl font-bold text-[#1C1B1A]">{viewStats?.weekViews || 0}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Views This Month</p>
          <p className="mt-1 text-2xl font-bold text-[#1C1B1A]">{viewStats?.monthViews || 0}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Total Views</p>
          <p className="mt-1 text-2xl font-bold text-[#1C1B1A]">{viewStats?.totalViews || 0}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Earnings</p>
          <p className="mt-1 text-2xl font-bold text-green-600">${(candidate.total_earnings_usd || 0).toLocaleString()}</p>
        </div>
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
            <p className="font-medium text-[#FE6E3E]">${candidate.monthly_rate?.toLocaleString()}/mo</p>
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
