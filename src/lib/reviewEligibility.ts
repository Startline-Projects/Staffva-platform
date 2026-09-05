/**
 * Who may review whom, and when — one definition for both sides.
 *
 * The SQL half of this lives in migration 00196: review_window_opened_at()
 * decides eligibility and review_is_revealed() decides visibility. This module
 * exists so the screens can explain a refusal without guessing at it, and it
 * must stay in step with those two functions.
 *
 * Eligibility is RELEASED MONEY, not engagement status. The four engagements
 * marked "released" in this database were open between 40 seconds and 2.2
 * hours, were never locked, never had a signed contract, and never moved a
 * penny — they are test clicks. A review is permanent public reputation
 * attached to a real person's livelihood; minting the first ones from those
 * would be the worst possible way to start.
 *
 * So nothing is eligible today, and the empty state is the screen.
 */

export type ReviewBlockReason =
  | "no_released_payment"
  | "already_submitted"
  | "not_a_party"
  | "window_closed"
  | "no_reply"
  | "exchange_complete";

export interface ReviewEligibilityInput {
  /** From review_window_opened_at(): null means no payment has been released. */
  windowOpenedAt: string | null;
  /** Has this side already submitted theirs? */
  submittedByYou: boolean;
  /** May this side write one right now? Straight from the RPC, not re-derived. */
  canSubmit: boolean;
  /** Is the other side's review readable by this caller? */
  theirVisible: boolean;
  /** Has the shared deadline passed? */
  windowClosed: boolean;
  /** Is the viewer actually the client or candidate on this engagement? */
  isParty: boolean;
}

/** Null means this side can submit a review right now. */
export function reviewBlockReason(input: ReviewEligibilityInput): ReviewBlockReason | null {
  if (!input.isParty) return "not_a_party";
  if (input.windowOpenedAt === null) return "no_released_payment";

  if (!input.submittedByYou) {
    // The late-entry case. Once the deadline reveals the other side's review,
    // this person can read it — so letting them write one now would produce a
    // reply, not a blind review. submit_review() refuses it in SQL; this is the
    // same rule, phrased for a screen.
    return input.canSubmit ? null : "window_closed";
  }

  // They wrote one. Which of the three endings is this?
  if (input.theirVisible) return "exchange_complete";
  if (input.windowClosed) return "no_reply";
  return "already_submitted";
}

/**
 * What each side is told. Every sentence here is checked against what the code
 * does — the reveal claims in particular, because "they can't see it yet" is
 * the promise the whole design rests on.
 */
export const REVIEW_BLOCK_COPY: Record<
  ReviewBlockReason,
  { title: string; detail: string }
> = {
  no_released_payment: {
    title: "Not ready for a review yet",
    // Backed by review_window_opened_at(), which reads released_at on
    // payment_periods and milestones and nothing else.
    detail:
      "Reviews open once the first payment on this engagement has been released. Nothing to do until then.",
  },
  already_submitted: {
    title: "Your review is in",
    // Backed: my_review_state() withholds the other side's rating and text
    // until you have submitted or the deadline passes, and withdraw_review()
    // deletes only while that is still true.
    detail:
      "It stays hidden until the other side submits theirs, or the deadline passes — whichever comes first. You can still withdraw it until then.",
  },
  exchange_complete: {
    title: "Both reviews are in",
    // Backed: withdraw_review() deletes only where NOT review_is_revealed().
    detail: "They're both visible now, and neither can be withdrawn.",
  },
  no_reply: {
    // Distinct from the state above, and it has to be: an earlier version
    // headed this "Both reviews are in" and then said "Nothing was submitted"
    // directly underneath — the screen contradicting itself on the one record
    // of the exchange either party has.
    title: "Your review is published",
    detail:
      "The deadline passed without one from them, so yours is visible on its own. It can no longer be withdrawn.",
  },
  window_closed: {
    title: "The window for this one has closed",
    // Backed: submit_review() raises 42501 once now() >= the shared anchor.
    detail:
      "Their review was published when the deadline passed, so a review written now would be a reply to one you've already read rather than an independent account. That's the trade for keeping both sides blind.",
  },
  not_a_party: {
    title: "Not your engagement",
    detail: "Only the two people on an engagement can review it.",
  },
};

/** One row of my_review_state() — the shape both dashboards read. */
export interface ReviewState {
  engagement_id: string;
  your_role: "client" | "candidate";
  counterparty: string;
  engagement_status: string;
  window_opened_at: string | null;
  can_submit: boolean;
  you_submitted: boolean;
  your_rating: number | null;
  your_body: string | null;
  your_submitted_at: string | null;
  their_visible: boolean;
  /** Their review exists and you are past the seal, but staff removed it. */
  their_withheld: boolean;
  their_rating: number | null;
  their_body: string | null;
  their_submitted_at: string | null;
  window_closed: boolean;
  /** Your own countdown. Null while you have written nothing and the window is
   *  open — in that state the anchor could only have come from THEIR
   *  submission, and returning it would disclose both that they wrote and
   *  when, since it is exactly their submitted_at plus 30 days. */
  reveal_at: string | null;
}

/** Reads a my_review_state() row through the shared predicate above. */
export function blockReasonFor(s: ReviewState): ReviewBlockReason | null {
  return reviewBlockReason({
    windowOpenedAt: s.window_opened_at,
    submittedByYou: s.you_submitted,
    canSubmit: s.can_submit,
    theirVisible: s.their_visible,
    windowClosed: s.window_closed,
    // The function only ever returns engagements the caller is a party to, so
    // a row in hand is proof of standing.
    isParty: true,
  });
}

/**
 * How long until the deadline reveals a lone review, in whole days.
 *
 * Returns null when there is nothing pending — and never a negative number: a
 * countdown that has run out says "any moment now", not "-3 days".
 */
export function daysUntilReveal(s: ReviewState): number | null {
  if (!s.reveal_at || s.window_closed || s.their_visible) return null;
  const ms = new Date(s.reveal_at).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}
