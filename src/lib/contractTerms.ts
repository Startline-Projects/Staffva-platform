/**
 * Whether an agreement can be signed, and if not, why.
 *
 * One definition, shared by the signing route, the candidate's contract page and
 * the dashboard card — so none of them can offer a signature the next one
 * refuses, or hide one the others would allow.
 */

export type BlockReason =
  | "not_awaiting_you"
  | "engagement_ended"
  | "terms_conflict"
  | "already_signed";

export interface SignabilityInput {
  contractStatus: string;
  engagementStatus: string | null;
  weeklyHours: number | null;
  paymentCycle: string | null;
  contractType: string | null;
}

/**
 * Can the engagement reproduce what the document claims?
 *
 * The generator writes `candidate_rate_usd` into the document as "$X USD per
 * hour" and `weekly_hours || 40` as the hours. But candidate_rate_usd does not
 * always hold an hourly rate: it holds a weekly amount when payment_cycle is
 * weekly, a monthly amount when monthly, and a project total for project work.
 * weekly_hours is NULL on seven of the eight contracts in this database, so the
 * "40 hours per week" in those documents was invented by the `|| 40`.
 *
 * Measured on the live rows: a candidate whose engagement records $3.00 per
 * MONTH holds a document promising "$3 USD per hour" for "40 hours per week" —
 * about 173 times the recorded amount. Signing it would execute an agreement
 * neither side meant.
 *
 * So: signable only when the engagement records an hourly basis and explicit
 * weekly hours. Everything else waits for a human to restate the terms.
 */
export function termsAreReproducible(t: {
  weeklyHours: number | null;
  paymentCycle: string | null;
}): boolean {
  // No stated hours means the document's hours figure was the hardcoded 40.
  if (t.weeklyHours == null) return false;
  // A cycle amount or a project total is not an hourly rate, however the
  // document renders it.
  if (t.paymentCycle != null) return false;
  return true;
}

/** Null means signable. Anything else is the reason it is not. */
export function signBlockReason(
  input: SignabilityInput,
  side: "candidate" | "client"
): BlockReason | null {
  if (input.contractStatus === "fully_executed") return "already_signed";

  // Executability is decided BEFORE whose turn it is. Otherwise a contract on
  // an engagement released in April, or one whose figures contradict the
  // engagement, is described to the candidate as merely "waiting on the client"
  // — which reads as "it's coming" when in fact it can never be signed by
  // anyone. Whose turn it is only matters among agreements that could still be
  // executed at all.
  if (input.engagementStatus !== "active") return "engagement_ended";
  if (!termsAreReproducible(input)) return "terms_conflict";

  const awaiting = side === "candidate" ? "pending_candidate" : "pending_client";
  if (input.contractStatus !== awaiting) return "not_awaiting_you";

  return null;
}

/** What the candidate is told, per reason. Never invents a next step. */
export const BLOCK_COPY: Record<BlockReason, { title: string; detail: string }> = {
  already_signed: {
    title: "Signed by both sides",
    detail: "This agreement is complete. You can read it here whenever you need to.",
  },
  not_awaiting_you: {
    title: "Waiting on the client",
    detail:
      "This agreement hasn't been countersigned yet. There's nothing for you to do until it is.",
  },
  engagement_ended: {
    title: "This engagement has ended",
    detail:
      "The work this agreement covers is finished, so it can no longer be signed. It stays here as a record.",
  },
  terms_conflict: {
    title: "The pay terms don't match your engagement",
    detail:
      // Both halves are backed: signing is refused by the shared predicate in
      // /api/contracts/sign, and alert-health raises a critical check for every
      // live contract in this state, which posts to Slack and makes the run
      // return non-2xx so it shows red on the cron dashboard. (It does NOT
      // email — an earlier version of this comment said "Slack and email",
      // which was wrong.) It deliberately promises no timeframe and no outcome.
      "The figures in this document don't match what's recorded for your engagement, so it can't be signed. Our team has been alerted. You don't need to do anything.",
  },
};
