/**
 * The candidate-email freeze, as code.
 *
 * Until now the freeze has been a human convention: the owner said "no
 * candidate emails until I have tested everything", and the way we kept that
 * promise was by not writing the call. Nothing in the product could stop one.
 * `sendEmail` sends immediately via Resend, and the outbox drain — which runs
 * every minute — selects every pending row with no filter on type or
 * recipient, so a message queued "dark" for later would be delivered inside
 * sixty seconds.
 *
 * That gap matters most for the thing being built now. Reference outreach goes
 * to a THIRD PARTY: a former manager who has never visited StaffVA, did not
 * consent, and would receive an unsolicited message about someone else's job
 * application. "We are not contacting anyone yet" has to be enforced, not
 * asserted, before their address is stored at all.
 *
 * The allowlist lives HERE, in code, and not in platform_settings, on purpose.
 * A database flag can be flipped by any service-role caller, a future admin
 * screen, or a migration, with nobody reviewing it. Lifting a freeze should
 * cost a deploy and a diff somebody reads.
 */

/** Who a message is going to. Not the same question as what it says. */
export type RecipientKind = "candidate" | "reference" | "client" | "staff";

/**
 * Email types that may still be sent to a frozen recipient kind.
 *
 * `candidate` keeps exactly two, and both are load-bearing for the account
 * itself rather than for recruitment:
 *  - email_verification: profiles.email_verified is written ONLY by the link
 *    inside this message, and sign-in is gated on that column. Freezing it
 *    would mean nobody could complete a signup at all.
 *  - password_reset: the only route back into a locked-out account. Kept for
 *    completeness, though it is currently inert — /forgot-password goes
 *    through supabase.auth.resetPasswordForEmail(), which mails from Supabase
 *    Auth and never passes through this file. Worth knowing before treating
 *    this allowlist as a complete picture of what candidates receive.
 *
 * `reference` keeps none, and that is the point of the file.
 */
const ALLOWED_TYPES: Record<RecipientKind, readonly string[]> = {
  candidate: ["email_verification", "password_reset"],
  reference: [],
  // Client and staff mail is not part of the candidate freeze. Clients are
  // paying users mid-engagement and staff mail is operational — an alert
  // nobody receives is worse than no alert.
  client: ["*"],
  staff: ["*"],
};

/** Recipient kinds currently under the freeze. */
export const FROZEN_KINDS: readonly RecipientKind[] = ["candidate", "reference"];

export function isFrozen(kind: RecipientKind): boolean {
  return FROZEN_KINDS.includes(kind);
}

/**
 * May we send this?
 *
 * Fail CLOSED: an unrecognised recipient kind is refused rather than allowed.
 * The failure mode of guessing wrong here is mailing a stranger.
 */
export function emailAllowed(kind: RecipientKind, emailType: string): boolean {
  const allowed = ALLOWED_TYPES[kind];
  if (!allowed) return false;
  if (allowed.includes("*")) return true;
  return allowed.includes(emailType);
}

/**
 * A refusal, phrased for a log rather than for a user. Suppression is not a
 * failure — the caller should carry on and report success for the action it
 * was actually performing.
 */
export function freezeReason(kind: RecipientKind, emailType: string): string {
  return `email suppressed: recipientKind=${kind} type=${emailType} is under the ${
    isFrozen(kind) ? "active" : "unknown-kind"
  } email freeze (src/lib/emailFreeze.ts)`;
}
