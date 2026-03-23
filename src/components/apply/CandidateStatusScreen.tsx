"use client";

import Link from "next/link";

interface Props {
  adminStatus: string;
}

const STATUS_CONFIG: Record<string, {
  icon: "check" | "clock" | "alert" | "x";
  iconBg: string;
  iconColor: string;
  title: string;
  message: string;
  showChecklist: boolean;
}> = {
  pending_speaking_review: {
    icon: "clock",
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    title: "Profile Under Review",
    message: "Your profile is complete and under review. We will notify you within 2 business days once your speaking assessment is complete and your profile goes live.",
    showChecklist: true,
  },
  approved: {
    icon: "check",
    iconBg: "bg-green-100",
    iconColor: "text-green-600",
    title: "Your Profile is Live",
    message: "Your profile is live and visible to clients. You will be notified when a client sends you a message.",
    showChecklist: false,
  },
  rejected: {
    icon: "x",
    iconBg: "bg-red-100",
    iconColor: "text-red-600",
    title: "Profile Needs Updates",
    message: "Your profile needs updates before going live. Check your email for instructions from our team.",
    showChecklist: false,
  },
  revision_required: {
    icon: "alert",
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    title: "Action Required",
    message: "Our team has reviewed your profile and left feedback. Check your email for details on what to update.",
    showChecklist: false,
  },
};

export default function CandidateStatusScreen({ adminStatus }: Props) {
  const config = STATUS_CONFIG[adminStatus] || STATUS_CONFIG.pending_speaking_review;

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

      {/* Revision required — show edit button */}
      {adminStatus === "revision_required" && (
        <div className="mt-6">
          <Link
            href="/apply"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
            Edit Your Profile
          </Link>
        </div>
      )}

      {/* Approved — show view profile button */}
      {adminStatus === "approved" && (
        <div className="mt-6">
          <Link
            href="/candidate/me"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
          >
            View Your Profile
          </Link>
        </div>
      )}

      {/* Pending review checklist */}
      {config.showChecklist && (
        <div className="mt-8 text-left mx-auto max-w-sm">
          <h3 className="font-semibold text-text mb-3">What happens next:</h3>
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
              <span className="text-sm text-text/70">Profile built</span>
            </li>
            <li className="flex items-start gap-2">
              <div className="h-5 w-5 mt-0.5 shrink-0 rounded-full border-2 border-primary flex items-center justify-center">
                <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              </div>
              <span className="text-sm text-text/70 font-medium">Speaking assessment review — in progress</span>
            </li>
            <li className="flex items-start gap-2">
              <div className="h-5 w-5 mt-0.5 shrink-0 rounded-full border-2 border-gray-300" />
              <span className="text-sm text-text/40">Profile goes live</span>
            </li>
          </ul>
        </div>
      )}

      {/* View profile link for all statuses */}
      <div className="mt-8">
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
