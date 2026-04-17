"use client";

import { useState } from "react";
import Link from "next/link";

interface Props {
  adminStatus: string;
  candidateId?: string;
}

const STATUS_CONFIG: Record<string, {
  icon: "check" | "clock" | "alert" | "x";
  iconBg: string;
  iconColor: string;
  title: string;
  message: string;
}> = {
  approved: {
    icon: "check",
    iconBg: "bg-green-100",
    iconColor: "text-green-600",
    title: "Your Profile is Live!",
    message: "Your profile is approved and visible to clients. Complete the AI interview to boost your profile ranking and attract more clients.",
  },
  active: {
    icon: "check",
    iconBg: "bg-green-100",
    iconColor: "text-green-600",
    title: "Application In Progress",
    message: "Your profile is in the pipeline. Complete your next steps to move forward in the process.",
  },
  profile_review: {
    icon: "check",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    title: "Profile Under Review",
    message: "Your Talent Specialist is reviewing your profile. You will be notified once your profile goes live.",
  },
  pending_2nd_interview: {
    icon: "check",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    title: "Pending 2nd Interview",
    message: "You have passed the first interview. Your second interview will be scheduled soon.",
  },
  pending_review: {
    icon: "check",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    title: "Pending 2nd Interview",
    message: "You have passed the first interview. Your second interview will be scheduled soon.",
  },
  pending_speaking_review: {
    icon: "check",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    title: "Pending 2nd Interview",
    message: "You have passed the first interview. Your second interview will be scheduled soon.",
  },
  rejected: {
    icon: "x",
    iconBg: "bg-red-100",
    iconColor: "text-red-600",
    title: "Profile Needs Updates",
    message: "Your profile needs updates before going live. Check your email for instructions from our team.",
  },
  revision_required: {
    icon: "alert",
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    title: "Action Required",
    message: "Our team has reviewed your profile and left feedback. Check your email for details on what to update.",
  },
  ai_interview_failed: {
    icon: "x",
    iconBg: "bg-red-100",
    iconColor: "text-red-600",
    title: "Your AI interview did not pass",
    message: "You need a score of 60 or above to continue. Please return to your dashboard to view your retake date.",
  },
};

const FALLBACK_CONFIG = {
  icon: "clock" as const,
  iconBg: "bg-blue-100",
  iconColor: "text-blue-600",
  title: "Application In Progress",
  message: "Your application is being reviewed. Please check your dashboard for your current status.",
};

export default function CandidateStatusScreen({ adminStatus, candidateId }: Props) {
  const config = STATUS_CONFIG[adminStatus] || FALLBACK_CONFIG;
  const showDashboardLink = !STATUS_CONFIG[adminStatus] || adminStatus === "ai_interview_failed";
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

  return (
    <div className="mx-auto max-w-xl px-6 py-16 text-center">
      <div className={`mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full ${config.iconBg}`}>
        {config.icon === "check" && (
          <svg className={`h-8 w-8 ${config.iconColor}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        )}
        {config.icon === "clock" && (
          <svg className={`h-8 w-8 ${config.iconColor}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
        {config.icon === "alert" && (
          <svg className={`h-8 w-8 ${config.iconColor}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        )}
        {config.icon === "x" && (
          <svg className={`h-8 w-8 ${config.iconColor}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
      </div>

      <h1 className="text-2xl font-bold text-text">{config.title}</h1>
      <p className="mt-3 text-text/60">{config.message}</p>

      {/* Failed AI interview or unknown status — direct to dashboard */}
      {showDashboardLink && (
        <div className="mt-6">
          <Link
            href="/candidate/dashboard"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
          >
            Go to Dashboard
          </Link>
        </div>
      )}

      {/* Revision required — show edit button */}
      {adminStatus === "revision_required" && (
        <div className="mt-6">
          <Link
            href="/apply"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
          >
            Edit Your Profile
          </Link>
        </div>
      )}

      {/* Approved or pending — show next steps */}
      {(adminStatus === "approved" || adminStatus === "active") && (
        <div className="mt-8 text-left mx-auto max-w-sm">
          <h3 className="font-semibold text-text mb-3">What you can do now:</h3>
          <ul className="space-y-2">
            <li className="flex items-start gap-2">
              <svg className="h-5 w-5 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <span className="text-sm text-text/70">Application submitted</span>
            </li>
            <li className="flex items-start gap-2">
              <svg className="h-5 w-5 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <span className="text-sm text-text/70">English assessment completed</span>
            </li>
            <li className="flex items-start gap-2">
              <svg className="h-5 w-5 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <span className="text-sm text-text/70">Voice recordings submitted</span>
            </li>
            <li className="flex items-start gap-2">
              <svg className="h-5 w-5 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <span className="text-sm text-text/70">Profile live and visible to clients</span>
            </li>
            <li className="flex items-start gap-2">
              <div className="h-5 w-5 mt-0.5 shrink-0 rounded-full border-2 border-primary flex items-center justify-center">
                <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              </div>
              <span className="text-sm text-text/70 font-medium">Take the AI interview to boost your ranking</span>
            </li>
          </ul>

          <div className="mt-6 space-y-3">
            {candidateId && (
              <div>
                <button
                  onClick={handleInterviewClick}
                  disabled={interviewLoading}
                  className="block w-full rounded-lg bg-primary px-6 py-2.5 text-center text-sm font-semibold text-white hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  {interviewLoading ? "Loading…" : "Start AI Interview"}
                </button>
                {interviewError && (
                  <p className="mt-2 text-sm text-red-600">{interviewError}</p>
                )}
              </div>
            )}
            <Link
              href="/candidate/dashboard"
              className="block w-full rounded-lg border border-gray-200 px-6 py-2.5 text-center text-sm font-medium text-text hover:bg-gray-50 transition-colors"
            >
              Go to Dashboard
            </Link>
          </div>
        </div>
      )}

      {/* View profile link */}
      <div className="mt-6">
        <Link
          href="/candidate/me"
          className="text-sm text-primary hover:text-primary/80 transition-colors"
        >
          View my profile &rarr;
        </Link>
      </div>
    </div>
  );
}
