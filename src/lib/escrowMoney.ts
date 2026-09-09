/**
 * What a client is charged for one escrow item — in one place.
 *
 * The charged amount is NOT stored anywhere. payment_periods.amount_usd and
 * milestones.amount_usd are the CANDIDATE's side; the client's figure is
 * computed at funding time in /api/escrow/fund and thereafter exists only in
 * the Stripe PaymentIntent. Every surface showing a client what something
 * cost has to re-derive it, and a surface deriving it differently is lying
 * about money.
 *
 * ⚠️ FUND ITSELF USES TWO DIFFERENT EXPRESSIONS, and this file reproduces
 * both rather than picking the tidier one:
 *
 *   periods    Math.round(a * 1.1 * 100) / 100            (fund ~line 214)
 *   milestones Math.round((a + a * 0.1) * 100)            (fund ~line 244)
 *
 * Those disagree by a cent on 5,981 of the first 500,000 cent values, because
 * `0.15 * 1.1` and `0.15 + 0.015` are different floats. That inconsistency is
 * a real defect IN FUND and worth fixing there — but until it is fixed, a
 * display that "corrects" it prints a number Stripe does not charge. A first
 * draft of this helper unified on the milestone form and silently moved every
 * period figure a cent off the charge.
 *
 * The other two rules:
 *
 *   THE BASIS. Hourly is `payment_cycle == null && weekly_hours != null` —
 *   not merely "no cycle". Where they differ, fund charges client_total_usd.
 *
 *   THE CLAMP. Notice shortens a period straddling ends_at. fund compares
 *   against `ends_at.slice(0,10)` — the DATE, not the timestamp — and clamps
 *   only on the hourly basis. ends_at is a timestamptz written as "now + 14
 *   days", so it essentially never falls on midnight: using the full
 *   timestamp here overstated a $2,000 period's charge by $44 and invented a
 *   fundable period that fund refuses outright.
 */

export const PLATFORM_FEE_RATE = 0.1;

/**
 * The row cap the billing page AND its CSV both use. Shared so the two cannot
 * report different totals for the same year purely because one fetched more
 * rows than the other.
 */
export const ROW_CAP = 2000;

export interface MoneyEngagement {
  payment_cycle: string | null;
  weekly_hours: number | null;
  client_total_usd: number | string | null;
  ends_at: string | null;
}

export function isHourlyBasis(e: MoneyEngagement): boolean {
  return e.payment_cycle == null && e.weekly_hours != null;
}

/** Fee-inclusive client charge for a PERIOD. Mirrors fund's period branch. */
export function periodClientCharge(candidateAmount: number, e: MoneyEngagement): number {
  if (!isHourlyBasis(e)) return Number(e.client_total_usd ?? 0);
  return Math.round(candidateAmount * (1 + PLATFORM_FEE_RATE) * 100) / 100;
}

/** Fee-inclusive client charge for a MILESTONE. Mirrors fund's milestone branch. */
export function milestoneClientCharge(candidateAmount: number): number {
  const fee = candidateAmount * PLATFORM_FEE_RATE;
  return Math.round((candidateAmount + fee) * 100) / 100;
}

export interface ClampResult {
  /** The candidate-side amount after any notice clamp. */
  candidateAmount: number;
  /** The period end fund would actually write, YYYY-MM-DD. */
  effectiveEnd: string | null;
  /** True when notice shortened this period. */
  clamped: boolean;
  /** True when the period begins on or after the engagement's end DATE — fund 409s. */
  startsAfterEnd: boolean;
}

/**
 * Mirrors the notice-clamping branch of escrow/fund, including its
 * date-only comparison and its hourly-basis gate.
 */
export function clampPeriod(
  periodStart: string | null,
  periodEnd: string | null,
  amountUsd: number,
  e: MoneyEngagement
): ClampResult {
  const base: ClampResult = {
    candidateAmount: amountUsd,
    effectiveEnd: periodEnd,
    clamped: false,
    startsAfterEnd: false,
  };
  // fund only clamps on the hourly basis; a cycle engagement is charged
  // client_total_usd whatever the dates say, and shortening its printed range
  // would describe a row fund never rewrites.
  if (!e.ends_at || !periodStart || !periodEnd || !isHourlyBasis(e)) return base;

  // DATE, not timestamp — this is fund's own `String(ends_at).slice(0, 10)`.
  const endsMs = new Date(String(e.ends_at).slice(0, 10)).getTime();
  const startMs = new Date(periodStart).getTime();
  const endMs = new Date(periodEnd).getTime();
  if (!Number.isFinite(endsMs) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return base;

  if (startMs >= endsMs) return { ...base, startsAfterEnd: true };
  if (endMs <= endsMs) return base;

  const span = endMs - startMs;
  if (span <= 0) return base;
  const fraction = (endsMs - startMs) / span;
  return {
    candidateAmount: Math.round(amountUsd * fraction * 100) / 100,
    effectiveEnd: new Date(endsMs).toISOString().split("T")[0],
    clamped: true,
    startsAfterEnd: false,
  };
}
