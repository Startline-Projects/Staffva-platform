/**
 * Which candidate-facing events reach the candidate, and how.
 *
 * Candidate email is frozen (src/lib/emailFreeze.ts). Every type below except
 * the two account types is suppressed at the moment it is sent — silently and
 * by design, because the alternative was mailing 256 people during a rebuild.
 * The consequence is easy to state and easy to forget: for every row where
 * `inApp` is null, something happens to a person and nobody tells them.
 *
 * This file makes that list explicit rather than leaving it to be rediscovered.
 * scripts/verify-notifications.mts reads the codebase for every
 * `recipientKind: "candidate"` send and fails if one is missing here, so a new
 * email cannot be added without a decision about how the candidate learns of it
 * while the freeze holds.
 *
 * `inApp` is a route the candidate can actually reach and where the fact is
 * legible — not a table that happens to hold the value. Where it is null, the
 * `note` says what the person does not find out.
 */

export type FreezeState = "delivered" | "suppressed";

export interface NotificationRow {
  /** emailType, exactly as passed to sendEmail/enqueueEmail. */
  type: string;
  /** What happened. */
  event: string;
  /** Is the mail actually sent today? */
  freeze: FreezeState;
  /** Route where the candidate can see this for themselves, or null. */
  inApp: string | null;
  note?: string;
}

export const CANDIDATE_NOTIFICATIONS: readonly NotificationRow[] = [
  // ── The two that still send ────────────────────────────────────────────────
  {
    type: "email_verification",
    event: "Signup needs an address confirmed",
    freeze: "delivered",
    inApp: "/verify-email",
    note: "Allowlisted: profiles.email_verified is written only by this link, and sign-in is gated on it.",
  },
  {
    type: "password_reset",
    event: "Locked out, asked for a reset",
    freeze: "delivered",
    inApp: "/reset-password",
    note:
      "Allowlisted in emailFreeze.ts, but nothing in this codebase sends it: /forgot-password calls " +
      "supabase.auth.resetPasswordForEmail(), which mails through Supabase Auth's own sender and never " +
      "reaches sendEmail(). So this delivers today — and it would keep delivering if the allowlist " +
      "entry were removed, because the freeze cannot see that path at all.",
  },

  // ── Work reaching them: all covered in-app, which is what steps 14-17 were for
  {
    type: "offer_received",
    event: "A client sent an offer",
    freeze: "suppressed",
    inApp: "/candidate/work",
    note: "Also the orange card at the top of /candidate/dashboard.",
  },
  {
    type: "job_invite",
    event: "A client invited them to a posted role",
    freeze: "suppressed",
    inApp: "/candidate/work",
    note: "Invitations outrank the skill heuristic in jobs_for_candidate (migration 00193).",
  },
  {
    type: "contract_ready_to_sign",
    event: "A contract is waiting for their signature",
    freeze: "suppressed",
    inApp: "/candidate/contracts",
  },
  {
    type: "contract_executed",
    event: "Both sides signed",
    freeze: "suppressed",
    inApp: "/candidate/contracts",
  },
  {
    type: "interview_booked",
    event: "A client booked an interview",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
    note: "UpcomingInterviews renders on the dashboard.",
  },
  {
    type: "interview_cancelled",
    event: "An interview was cancelled",
    freeze: "suppressed",
    inApp: null,
    note:
      "GAP, and it read as covered because UpcomingInterviews is on the dashboard. But a cancellation " +
      "is not rendered there — the row simply disappears. The candidate has to have memorised that a " +
      "booking existed to notice it is gone, and is told no reason. Absence is not a notification.",
  },
  {
    type: "interview_reminder",
    event: "An interview is soon",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
    note: "WEAK: a reminder's whole job is to arrive before the person would have looked.",
  },

  // ── Their application ──────────────────────────────────────────────────────
  {
    type: "profile_approved",
    event: "Approved to go live",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
    note: "The dashboard becomes the live portal — the loudest in-app signal there is.",
  },
  {
    type: "application_outcome",
    event: "Application decided",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
    note: "rejection_reason and the appeal flow render there.",
  },
  {
    type: "revision_requested",
    event: "Staff asked for a change",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
    note: "admin_revision_note renders there.",
  },
  {
    type: "profile_revisions_requested",
    event: "Talent specialist asked for a change",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
  },
  {
    type: "assessment_result",
    event: "English test graded",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
  },
  {
    type: "interview_retake",
    event: "A retake is available",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
    note: "retake_available_at renders there.",
  },
  {
    type: "video_intro_reviewed",
    event: "Video intro reviewed",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
  },
  {
    type: "id_verification_passed",
    event: "ID check passed",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
  },
  {
    type: "id_verification_failed",
    event: "ID check failed",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
  },
  {
    type: "stage_nudge",
    event: "Stalled partway through signup",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
    note: "WEAK: a nudge targets exactly the people who have stopped opening the dashboard.",
  },
  {
    type: "profile_reminder",
    event: "Talent specialist nudged them",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
    note: "WEAK: same shape as stage_nudge.",
  },
  {
    type: "availability_nudge",
    event: "Availability has gone stale",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
    note: "AvailabilityRateCard shows the staleness state directly (step 13).",
  },
  {
    type: "queue_placement",
    event: "Placed in the screening queue",
    freeze: "suppressed",
    inApp: null,
    note:
      "Deliberate. The dashboard makes no queue-position claim because the admin queue is re-sorted " +
      "by hand, so any number shown would be a promise nobody controls.",
  },

  // ── Their talking to staff ─────────────────────────────────────────────────
  {
    type: "recruiter_assigned",
    event: "A talent specialist was assigned",
    freeze: "suppressed",
    inApp: "/candidate/messages",
  },
  {
    type: "edit_request_approved",
    event: "A requested profile edit was approved",
    freeze: "suppressed",
    inApp: "/candidate/messages",
    note: "MessageThread renders message_type 'edit_request' explicitly.",
  },
  {
    type: "edit_request_declined",
    event: "A requested profile edit was declined",
    freeze: "suppressed",
    inApp: "/candidate/messages",
  },
  {
    type: "staff_composed",
    event: "One of four canned lifecycle emails (/api/candidate-emails)",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
    note:
      "The name overstates it: not free text, but a fixed registry of four templates — " +
      "application_received, english_test_invitation, english_test_passed, profile_approved — each " +
      "restating a state the dashboard already shows. Separately, the browser call at " +
      "components/apply/ApplicationForm.tsx:525 cannot succeed regardless of the freeze: the route " +
      "requires CRON_SECRET, so that one returns 401.",
  },

  // ── Money ──────────────────────────────────────────────────────────────────
  {
    type: "payout",
    event: "A payout was sent",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
  },
  {
    type: "payout_account_active",
    event: "Payout account is ready",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
    note: "The dashboard shows whether payout_method is set, which is the same fact.",
  },
  {
    type: "payout_account_attention",
    event: "Payout account needs attention",
    freeze: "suppressed",
    inApp: "/candidate/dashboard",
    note:
      "PayoutSetupCard branches on payout_status === 'suspended' and renders the red card with a " +
      "Resolve button, so this one genuinely survives the freeze.",
  },

  // ── Everything else ────────────────────────────────────────────────────────
  {
    type: "photo_rejected",
    event: "Profile photo rejected",
    freeze: "suppressed",
    inApp: null,
    note:
      "GAP, and not a surfacing problem — a recording one. /api/admin/photo-review sets " +
      "pending_photo_url = null and photo_pending_review = false on reject, leaving no column that " +
      "says a rejection happened and none that holds the reason; the note the reviewer typed exists " +
      "only inside the suppressed email body. No screen can show what nothing stores. Closing this " +
      "needs a column, not a component.",
  },
  {
    type: "profile_viewed",
    event: "A client viewed their profile",
    freeze: "suppressed",
    inApp: null,
    note: "No candidate-facing surface reads profile_views at all.",
  },
  {
    type: "weekly_digest",
    event: "Weekly market activity",
    freeze: "suppressed",
    inApp: null,
    note:
      "Lowest stakes on this list: it reports platform-wide counts, not anything about this person. " +
      "/candidate/work carries the part that concerns them, which is the roles they match.",
  },
];

/** Rows where the freeze means nobody is told anything, anywhere. */
export function silentEvents(): NotificationRow[] {
  return CANDIDATE_NOTIFICATIONS.filter(
    (r) => r.freeze === "suppressed" && r.inApp === null
  );
}

/** Types this matrix accounts for — the drift guard reads this. */
export function knownTypes(): Set<string> {
  return new Set(CANDIDATE_NOTIFICATIONS.map((r) => r.type));
}
