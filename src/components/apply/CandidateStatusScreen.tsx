"use client";

import Link from "next/link";
import { isLive } from "@/lib/candidateStatus";

/**
 * The /apply revisit surface: a completion CONFIRMATION, nothing more.
 *
 * It used to carry its own copy of the assessment logic — an Interview 1/2
 * checklist, a Start/Retake button, retake dates and pricing copy. That was
 * a second implementation of exactly the state machine the dashboard's
 * assessment cards own (free first sittings, the Interview 1 → Interview 2
 * order gate, cooldowns, $5 retakes), and two implementations of a machine
 * that takes money WILL disagree eventually. The owner's flow (2026-09-13)
 * puts the choosing on the dashboard, so this screen now confirms what was
 * submitted and routes there — it never offers a start itself.
 *
 * A fresh profile-builder submit no longer lands here at all: it hands off
 * to the dashboard walkthrough. This renders only when someone returns to
 * /apply with a finished application.
 */

interface Props {
  adminStatus: string;
}

// `tone` is the Atlas .state-icon-xl variant (success / amber / danger / done).
// It replaces the old bg-*-100 / text-*-600 Tailwind pair — same four moods,
// drawn with Atlas tokens instead of the legacy palette.
const STATUS_CONFIG: Record<string, {
  icon: "check" | "clock" | "alert" | "x";
  tone: "success" | "amber" | "danger" | "done";
  title: string;
  message: string;
}> = {
  approved: {
    icon: "check",
    tone: "success",
    title: "Your Profile is Live!",
    message: "Your profile is approved and visible to clients. Clients can search for you and reach out about work directly.",
  },
  active: {
    icon: "check",
    tone: "success",
    title: "Application In Progress",
    message: "Your profile is in the pipeline. Complete your next steps to move forward in the process.",
  },
  profile_review: {
    icon: "check",
    tone: "amber",
    title: "Profile Under Review",
    // No turnaround promised: nothing measures review latency and no stated
    // SLA has ever been met here.
    message: "Someone is doing a final review of your profile. The outcome appears on your dashboard.",
  },
  pending_review: {
    icon: "check",
    tone: "amber",
    title: "Profile Under Review",
    // No turnaround promised: nothing measures review latency and no stated
    // SLA has ever been met here.
    message: "Someone is doing a final review of your profile. The outcome appears on your dashboard.",
  },
  // A decline, not a revision request. This read "Profile Needs Updates —
  // check your email for instructions": a recoverable-sounding prompt for a
  // final decision, pointing at an email the freeze withholds. Someone could
  // have sat waiting for instructions that were never coming.
  rejected: {
    icon: "x",
    tone: "danger",
    title: "We're not taking your application forward",
    message: "Your dashboard has the reason and the date you can apply again.",
  },
  revision_required: {
    icon: "alert",
    tone: "amber",
    title: "Action Required",
    message: "Someone reviewed your profile and left feedback. Your dashboard shows what to change.",
  },
  ai_interview_failed: {
    icon: "x",
    tone: "danger",
    title: "Your AI interview did not pass",
    message: "You need a score of 60 or above to continue. Please return to your dashboard to view your retake date.",
  },
};
// admin_status 'approved' is being renamed to 'live' ADDITIVELY — both labels
// are live values, so both must key the same screen. Without this a live
// candidate revisiting /apply fell through to the fallback and was told their
// application was "being reviewed".
STATUS_CONFIG.live = STATUS_CONFIG.approved;

const FALLBACK_CONFIG = {
  icon: "clock" as const,
  tone: "done" as const,
  title: "Application In Progress",
  message: "Your application is being reviewed. Please check your dashboard for your current status.",
};

const ARROW = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function CandidateStatusScreen({ adminStatus }: Props) {
  const config = STATUS_CONFIG[adminStatus] || FALLBACK_CONFIG;
  const showDashboardLink = !STATUS_CONFIG[adminStatus] || adminStatus === "ai_interview_failed";

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <div className="form-card signin-card">
        <div className="signin-state state-centered">
          <div className={`state-icon-xl ${config.tone}`} aria-hidden>
            {config.icon === "check" && (
              <svg width="30" height="30" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            )}
            {config.icon === "clock" && (
              <svg width="30" height="30" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            {config.icon === "alert" && (
              <svg width="30" height="30" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            )}
            {config.icon === "x" && (
              <svg width="30" height="30" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </div>

          <h1 className="state-title">{config.title}</h1>
          <p className="state-subtitle">{config.message}</p>

          {/* Failed AI interview or unknown status — direct to dashboard */}
          {showDashboardLink && (
            <Link href="/candidate/dashboard" className="state-action-btn">
              Go to Dashboard
              {ARROW}
            </Link>
          )}

          {/* Revision required — show edit button */}
          {adminStatus === "revision_required" && (
            <Link href="/apply" className="state-action-btn">
              Edit Your Profile
              {ARROW}
            </Link>
          )}

          {/* Approved or pending — confirm what's in, then route the choosing
              of assessments to the dashboard cards, which own every state
              (free first sittings, cooldown dates, the Interview 1 → 2 order,
              retake pricing). No start button here, ever. */}
          {(isLive(adminStatus) || adminStatus === "active") && (
            <div className="mt-2 w-full max-w-sm mx-auto text-left">
              <div className="ahead-card">
                <h3 className="label">What you&apos;ve done:</h3>
                {/* .pwd-criteria is the Atlas met/unmet checklist: `met` draws
                    the green tick, an item without it draws the open ring. One
                    column, because these read as sentences, not chips. */}
                <ul className="pwd-criteria" style={{ gridTemplateColumns: "1fr" }}>
                  <li className="met">Application submitted</li>
                  <li className="met">Voice recordings submitted</li>
                  {/* NOT "live and visible" — at this moment the profile is
                      submitted and review has not happened. */}
                  <li className="met">Profile submitted for review</li>
                </ul>
              </div>

              <div className="mt-6">
                <Link href="/candidate/dashboard" className="btn-submit" style={{ textDecoration: "none" }}>
                  <span className="submit-label">Choose your assessments</span>
                  <svg className="arrow" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                    <path d="M3.75 9h10.5M9.75 4.5 14.25 9l-4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
                <p className="mt-3 text-[12.5px] text-[var(--ink-mute)]">
                  The English test, Interview 1 and Interview 2 are optional
                  and live on your dashboard — your first sitting of each is
                  free, and passing lifts you in search.
                </p>
                {/* The only pre-approval door to the video recorder. Atlas puts
                    record-intro inside the pipeline; without a link here the whole
                    feature was dark for the cohort meant to record before review
                    (0 of 256 have one — the step-11 diagnosis, still true). */}
                <div className="signin-alt-actions">
                  <Link href="/profile/video-intro" className="alt-action">
                    <span className="alt-label">Add a 75-second video intro (optional — clients watch it first)</span>
                    <span className="alt-link">Record</span>
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* View profile link */}
          <p className="state-fine-print">
            <Link href="/candidate/me">View my profile &rarr;</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
