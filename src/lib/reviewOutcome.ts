import { createClient } from "@supabase/supabase-js";

/**
 * What it means for an application to be decided, in one place.
 *
 * The pattern is approvalGates.ts's: one definition, many callers. Every gate
 * that costs money — the AI interview token mint, the English assessment deal —
 * asks the same question here rather than each inventing its own idea of
 * "closed", which is how the interview mint ended up with no status check at
 * all while the English route checked two.
 */

/** How long a rejected account waits before it may apply again. */
export const HOLD_MONTHS = 6;

export interface OutcomeFields {
  admin_status?: string | null;
  permanently_blocked?: boolean | null;
  reapply_eligible_at?: string | null;
  rejection_reason?: string | null;
  rejected_at?: string | null;
  appeal_submitted_at?: string | null;
  appeal_decision?: string | null;
  appeal_response?: string | null;
  review_entered_at?: string | null;
}

export function computeReapplyEligibleAt(from: Date = new Date()): string {
  const d = new Date(from);
  d.setMonth(d.getMonth() + HOLD_MONTHS);
  return d.toISOString();
}

/**
 * Is this application closed — i.e. should the funnel refuse to spend money on
 * it?
 *
 * Deliberately does NOT mean "should this person be locked out". A held
 * candidate keeps their login, their dashboard and their security settings:
 * the dashboard is the only place they can read the decision at all while the
 * email freeze is on, and taking it away would confiscate their own record to
 * enforce a hold that a second email address defeats anyway.
 */
export function applicationClosed(c: OutcomeFields | null | undefined): boolean {
  if (!c) return false;
  if (c.permanently_blocked) return true;
  return c.admin_status === "rejected";
}

/** Has the hold expired, so this account may start again? */
export function mayReapply(c: OutcomeFields | null | undefined): boolean {
  if (!c) return false;
  if (c.permanently_blocked) return false;
  if (c.admin_status !== "rejected") return false;
  if (!c.reapply_eligible_at) return false;
  return Date.parse(c.reapply_eligible_at) <= Date.now();
}

/**
 * The candidate-facing outcome, as one value.
 *
 * `rejected` deliberately splits: disputes/resolve sets admin_status='rejected'
 * together with permanently_blocked when a client's fraud dispute is upheld, so
 * a single 'rejected' branch would show a banned account the friendly
 * "you can apply again on <date>" card. They are different outcomes and they
 * get different screens.
 */
export type OutcomeState =
  | "in_progress"
  | "under_review"
  | "revision_required"
  | "declined"
  | "closed_permanently"
  | "approved";

export function outcomeState(c: OutcomeFields | null | undefined): OutcomeState {
  if (!c) return "in_progress";
  if (c.permanently_blocked) return "closed_permanently";
  switch (c.admin_status) {
    case "approved":
      return "approved";
    case "rejected":
      return "declined";
    case "revision_required":
    case "changes_requested":
      return "revision_required";
    case "under_review":
    case "pending_review":
      return "under_review";
    default:
      return "in_progress";
  }
}

/** Statuses a rejection may be applied to. Compare-and-swapped by the route so
 *  an approved candidate mid-engagement cannot be rejected by a stale click. */
export const REJECTABLE_FROM = [
  "active",
  "under_review",
  "pending_review",
  "revision_required",
  "changes_requested",
  "ai_interview_failed",
  "pending_2nd_interview",
] as const;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Append one decision to the history. Never throws: an audit write that fails
 * must not roll back the decision it is describing, and a missing row is a
 * smaller problem than a reviewer's click silently erroring.
 */
export async function recordStatusEvent(params: {
  candidateId: string;
  from: string | null;
  to: string;
  actorId?: string | null;
  actorRole?: "system" | "admin" | "recruiter" | "candidate";
  reason?: string | null;
}): Promise<void> {
  try {
    await admin().from("candidate_status_events").insert({
      candidate_id: params.candidateId,
      from_status: params.from,
      to_status: params.to,
      actor_id: params.actorId ?? null,
      actor_role: params.actorRole ?? "system",
      reason: params.reason ?? null,
    });
  } catch (err) {
    console.error("[status-event] insert failed:", err);
  }
}

/** A date a candidate can read. */
export function formatHoldDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
