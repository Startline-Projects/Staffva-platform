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
}

export default function CandidateDashboardPage() {
  const [candidate, setCandidate] = useState<CandidateData | null>(null);
  const [viewStats, setViewStats] = useState<ViewStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Load candidate data
      const { data: c } = await supabase
        .from("candidates")
        .select("id, display_name, admin_status, role_category, monthly_rate, availability_status, total_earnings_usd, profile_photo_url, english_written_tier, speaking_level")
        .eq("user_id", session.user.id)
        .single();

      if (c) setCandidate(c);

      // Load view stats
      try {
        const res = await fetch("/api/profile-views", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const stats = await res.json();
          setViewStats(stats);
        }
      } catch {
        // silent
      }

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
          <Link href="/apply" className="mt-2 inline-block text-sm font-medium text-[#FE6E3E] hover:underline">
            Edit my profile →
          </Link>
        </div>
      )}

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
