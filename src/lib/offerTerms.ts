/**
 * Offer terms, money, and whose turn it is — in one place.
 *
 * Three things here are easy to get subtly wrong, and each has already been
 * got wrong somewhere on this platform:
 *
 * 1. WHOSE TURN. It is the parity of engagement_offers.current_round, NOT
 *    offer_counters.proposed_by. The original offer is the client's round
 *    zero, so an even round is waiting on the candidate and an odd round is
 *    waiting on the client. Reading the last counter's author instead gives
 *    the same answer most of the time and the wrong one whenever a round row
 *    failed to write.
 *
 * 2. THE MONEY. The client's cost is rate × hours × 4.33 × 1.1 — the 10%
 *    platform fee is charged ON TOP of what the candidate earns. Atlas's
 *    prototype says "Atlas takes 8% from candidate — this is your full cost",
 *    which is both a different rate and the opposite direction. Anything
 *    shown to a client has to be the fee-inclusive figure.
 *
 * 3. THE DIFF. Countering OVERWRITES the envelope's terms (see
 *    /api/offers/negotiate), and no round-zero row is ever written to
 *    offer_counters. So the client's ORIGINAL terms are unrecoverable the
 *    moment a candidate counters: a round-1 card has nothing to diff against.
 *    diffTerms returns nulls there rather than inventing a "was", because
 *    "~~$15~~ $13" beside a number nobody stored is exactly the kind of
 *    strike-through Atlas draws from thin air.
 */

export const WEEKS_PER_MONTH = 4.33;
/** The client pays this multiple of the candidate's earnings. */
export const CLIENT_FEE_MULTIPLIER = 1.1;

export interface OfferTerms {
  hourly_rate: number;
  hours_per_week: number;
  contract_length: string;
  start_date: string;
}

export interface OfferMoney {
  /** What the candidate earns per week, before the platform fee. */
  candidateWeekly: number;
  /** What the CLIENT pays per month, fee included. This is the headline. */
  clientMonthly: number;
  /** The fee portion of clientMonthly. */
  feeMonthly: number;
}

export function offerMoney(rate: number, hoursPerWeek: number): OfferMoney {
  const candidateWeekly = rate * hoursPerWeek;
  const candidateMonthly = candidateWeekly * WEEKS_PER_MONTH;
  const clientMonthly = candidateMonthly * CLIENT_FEE_MULTIPLIER;
  return {
    candidateWeekly: Math.round(candidateWeekly * 100) / 100,
    clientMonthly: Math.round(clientMonthly * 100) / 100,
    feeMonthly: Math.round((clientMonthly - candidateMonthly) * 100) / 100,
  };
}

export type Turn = "client" | "candidate";

/** Even round = waiting on the candidate; odd = waiting on the client. */
export function whoseTurn(currentRound: number | null | undefined): Turn {
  return (currentRound ?? 0) % 2 === 1 ? "client" : "candidate";
}

export type Direction = "up" | "down" | "same";

export interface TermChange<T> {
  value: T;
  /** The previous round's value, or null when no earlier round was stored. */
  previous: T | null;
  direction: Direction;
}

function change<T extends string | number>(value: T, previous: T | null): TermChange<T> {
  // Both "no earlier round" and "unchanged since the earlier round" yield a
  // null previous, because the UI draws a strike-through whenever previous is
  // non-null — and a strike-through through an identical value is noise.
  if (previous === null || previous === value) {
    return { value, previous: null, direction: "same" };
  }
  const dir: Direction =
    typeof value === "number" && typeof previous === "number"
      ? value > previous
        ? "up"
        : "down"
      : "same";
  return { value, previous, direction: dir };
}

export interface TermsDiff {
  hourly_rate: TermChange<number>;
  hours_per_week: TermChange<number>;
  contract_length: TermChange<string>;
  start_date: TermChange<string>;
}

/**
 * Current terms against the previous round's, when there is one.
 *
 * `previous` must be null for a first counter — the terms it replaced were
 * overwritten in the envelope and never stored anywhere else.
 */
export function diffTerms(current: OfferTerms, previous: OfferTerms | null): TermsDiff {
  return {
    hourly_rate: change(Number(current.hourly_rate), previous ? Number(previous.hourly_rate) : null),
    hours_per_week: change(Number(current.hours_per_week), previous ? Number(previous.hours_per_week) : null),
    contract_length: change(current.contract_length, previous?.contract_length ?? null),
    start_date: change(current.start_date, previous?.start_date ?? null),
  };
}

/** Offers lapse this many days after the latest sent_at; each counter resets it. */
export const OFFER_EXPIRY_DAYS = 5;

/** When an open offer lapses, or null if it is not on the clock. */
export function expiresAt(sentAt: string | null, status: string): Date | null {
  if (!sentAt) return null;
  if (!["sent", "viewed", "countered"].includes(status)) return null;
  return new Date(new Date(sentAt).getTime() + OFFER_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

/** Bucket for the proposals page tabs. Derived, never stored. */
export type ProposalBucket = "awaiting_them" | "awaiting_you" | "accepted" | "closed";

export function bucketFor(status: string, currentRound: number | null | undefined): ProposalBucket {
  if (status === "accepted") return "accepted";
  if (status === "declined" || status === "expired") return "closed";
  // A draft was never sent, so it is the client's move — but it is NOT an
  // open proposal, and callers must exclude it from "if every open proposal is
  // accepted". Currently unreachable (the send path always inserts 'sent'),
  // but 'draft' is the column default, so the case is real.
  if (status === "draft") return "awaiting_you";
  return whoseTurn(currentRound) === "client" ? "awaiting_you" : "awaiting_them";
}
