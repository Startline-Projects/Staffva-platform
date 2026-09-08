/**
 * Buying an optional assessment.
 *
 * The assessments stopped being required, which changed who pays for them.
 * When every candidate had to sit the English test and the interview to be
 * listed at all, the vendor bill was a cost of acquiring supply. Now they are
 * things a candidate chooses in order to rank higher, and the candidate pays.
 *
 * PRICE NOTE, because it is not obvious from the number: at $5 the vendor
 * cost is small — pennies for an English sitting, well under a dollar for an
 * interview — and STRIPE'S OWN FEE (roughly $0.45 on a $5 charge, ~9%) is the
 * single largest line item. That is the argument against discounting to $3 or
 * bundling two $5 charges as two separate transactions rather than one.
 */

export type AssessmentKind = "english" | "interview";

export const ASSESSMENT_PRICES: Record<AssessmentKind, number> = {
  english: 500,
  interview: 500,
};

export const ASSESSMENT_LABELS: Record<AssessmentKind, string> = {
  english: "English assessment",
  interview: "Skills interview",
};

export function isAssessmentKind(v: unknown): v is AssessmentKind {
  return v === "english" || v === "interview";
}

/** $5.00 — for copy. Cents are the source of truth; this is display only. */
export function priceLabel(kind: AssessmentKind): string {
  const cents = ASSESSMENT_PRICES[kind];
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/**
 * The reasons we hand money back without being asked. These strings are
 * written to assessment_purchases.refund_reason and read by the refund
 * worker, so they are a shared vocabulary, not labels.
 *
 * `platform_failure` is the one that carries real weight. 29% of candidates
 * once had their first interview answer recorded as silence because OUR audio
 * pipeline failed — under the old free model that was a bad experience, and
 * under this one it is taking $5 from someone in Manila and failing them for
 * our bug.
 *
 * ORDER OF REMEDIES, because a refund is the second-best one: a candidate who
 * paid $5 wanted the assessment, not the $5. When a sitting fails on our side
 * the first move is release_assessment_entitlement, which hands the sitting
 * back. Refunding is for when it cannot be re-offered — the re-offer budget
 * is spent, or the sitting can never be delivered at all.
 */
export const REFUND_REASONS = {
  platformFailure: "platform_failure",
  notDelivered: "not_delivered",
  duplicateCharge: "duplicate_charge",
  supportGranted: "support_granted",
} as const;

/** The candidate columns an eligibility check needs. Select exactly these —
 *  PostgREST returns only what you ask for, and a missing column reads as
 *  "eligible", which would sell a sitting to someone who cannot take it. */
export const ELIGIBILITY_COLUMNS =
  "id, permanently_blocked, admin_status, reapply_eligible_at, " +
  "english_attempts_exhausted, retake_available_at, english_written_tier, " +
  "ai_interview_passed, interview1_passed";

export interface EligibilityInput {
  permanently_blocked?: boolean | null;
  admin_status?: string | null;
  reapply_eligible_at?: string | null;
  english_attempts_exhausted?: boolean | null;
  retake_available_at?: string | null;
  english_written_tier?: string | null;
  ai_interview_passed?: boolean | null;
  interview1_passed?: boolean | null;
  /** Has any skills-interview history — the grandfather clause for
   *  candidates who were mid-track when the interview was split in two.
   *  Comes from a separate count, not a candidates column. */
  hasSkillsHistory?: boolean;
}

export type Eligibility = { ok: true } | { ok: false; reason: string };

/**
 * Can this candidate sit this assessment right now?
 *
 * Called at CHECKOUT, before any money moves — so we never sell a sitting the
 * candidate cannot take. It is not the start-time enforcement: the two start
 * paths (the English deal route and the interview app's handleStart) each run
 * their own, older gates, which is why this does not duplicate them. The
 * division matters because the gap between paying and starting can be days,
 * and a decision can land on the application in between.
 */
export function checkEligibility(
  kind: AssessmentKind,
  c: EligibilityInput | null | undefined
): Eligibility {
  if (!c) return { ok: false, reason: "We couldn't find your profile." };

  if (c.permanently_blocked) {
    return { ok: false, reason: "This assessment isn't available on your account." };
  }

  // A decided application does not get to spend more money. Mirrors the check
  // the interview token mint applies (see applicationClosed in reviewOutcome).
  if (c.admin_status === "rejected" || c.admin_status === "declined") {
    return { ok: false, reason: "Your application is closed." };
  }

  if (kind === "english") {
    if (c.english_attempts_exhausted) {
      return { ok: false, reason: "You've used all your English assessment attempts." };
    }
    if (c.english_written_tier) {
      return { ok: false, reason: "You've already completed the English assessment." };
    }
    if (c.retake_available_at && new Date(c.retake_available_at).getTime() > Date.now()) {
      return { ok: false, reason: "Your retake isn't open yet." };
    }
  }

  if (kind === "interview") {
    if (c.ai_interview_passed) {
      return { ok: false, reason: "You've already passed the skills interview." };
    }

    // THE ORDER GATE. The interview app refuses to start a skills interview
    // until Interview 1 (behavioral) is passed — see handleStart in the
    // interview app's api/interview/session route.
    //
    // Without this check the $5 is a trap: the candidate pays, arrives at the
    // interview app, and is silently forked into the free behavioral round
    // instead of the thing they bought. If they then fail Interview 1, the
    // skills interview they paid for is unreachable for good.
    //
    // Interview 1 is free. Sell the skills interview only once its door is
    // actually open.
    // No ai_interview_passed term here: the check above already returned for
    // that case, so including it would be a dead branch.
    const throughInterview1 = c.interview1_passed === true || c.hasSkillsHistory === true;
    if (!throughInterview1) {
      return {
        ok: false,
        reason: "Take Interview 1 first — it's free, and it opens the skills interview.",
      };
    }
  }

  return { ok: true };
}
