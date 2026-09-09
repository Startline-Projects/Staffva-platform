/**
 * Paid access to interview transcripts — the one place the rule lives.
 *
 * $10/month or $50/year per client account, unlocking every candidate's
 * interview transcript and the shareable half of their scorecard.
 */

export const TRANSCRIPT_PLANS = {
  month: { label: "Monthly", priceUsd: 10, blurb: "$10 a month" },
  year: { label: "Yearly", priceUsd: 50, blurb: "$50 a year" },
} as const;

export type TranscriptInterval = keyof typeof TRANSCRIPT_PLANS;

export function priceIdFor(interval: TranscriptInterval): string | null {
  const id =
    interval === "month"
      ? process.env.STRIPE_TRANSCRIPTS_MONTHLY_PRICE_ID
      : process.env.STRIPE_TRANSCRIPTS_YEARLY_PRICE_ID;
  return id && id.trim() !== "" ? id : null;
}

export interface AccessRow {
  transcript_access_status: string | null;
  transcript_access_until: string | null;
  transcript_access_interval: string | null;
}

/**
 * THE access rule. One column, one comparison.
 *
 * Not `status === 'active'`. Stripe keeps a cancelled subscription 'active'
 * until its period ends, and a failed renewal sits in 'past_due' with
 * period_end unmoved — so the paid-for window is exactly what
 * transcript_access_until describes, in every one of those states. Checking
 * status as well would take access away from someone who has paid for it, on
 * the day their card expired, which is the wrong direction to fail on a thing
 * they bought.
 */
export function hasTranscriptAccess(row: AccessRow | null | undefined): boolean {
  if (!row?.transcript_access_until) return false;
  const until = new Date(row.transcript_access_until).getTime();
  return Number.isFinite(until) && until > Date.now();
}

/**
 * The scorecard columns a paying client may read.
 *
 * ai_notes IS NOT HERE AND MUST NOT BE ADDED. The scoring prompt defines it as
 * "internal observations — especially any claimed skill or tool that FAILED
 * verification when probed, contradictions" — the interviewer's private
 * red-flag field. It was once rendered to every logged-in client as "Screening
 * notes" and was deliberately removed; src/app/candidate/[id]/page.tsx still
 * carries the note saying so. Selling it would re-open that leak and charge
 * for it. strengths and weaknesses are the shareable halves — the candidate
 * reads those on their own results page, so nothing here is something the
 * candidate cannot see about themselves.
 */
export const SHAREABLE_SCORECARD_COLUMNS = [
  "overall_score",
  "passed",
  "completed_at",
  "technical_knowledge_score",
  "technical_knowledge_feedback",
  "problem_solving_score",
  "problem_solving_feedback",
  "communication_score",
  "communication_feedback",
  "experience_depth_score",
  "experience_depth_feedback",
  "professionalism_score",
  "professionalism_feedback",
  "strengths",
  "weaknesses",
  "transcript",
].join(", ");

/** A transcript turn, after normalisation. */
export interface TranscriptTurn {
  speaker: "interviewer" | "candidate";
  text: string;
}

/**
 * `ai_interviews.transcript` is jsonb and its shape has changed across
 * interview versions. Normalised here rather than in the component, so a row
 * we cannot read renders as "unavailable" instead of throwing inside React.
 */
export function normaliseTranscript(raw: unknown): TranscriptTurn[] | null {
  if (raw == null) return null;

  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      // A plain string transcript: one block, speaker unknown. Attributing it
      // to either side would be inventing who said what.
      const text = String(raw).trim();
      return text ? [{ speaker: "candidate", text }] : null;
    }
  }

  if (!Array.isArray(value)) return null;

  const turns: TranscriptTurn[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text
      : typeof o.content === "string" ? o.content
      : typeof o.message === "string" ? o.message
      : null;
    if (!text || !text.trim()) continue;
    const rawRole = String(o.role ?? o.speaker ?? "").toLowerCase();
    const speaker: TranscriptTurn["speaker"] =
      rawRole.includes("assistant") || rawRole.includes("interviewer") || rawRole.includes("ai")
        ? "interviewer"
        : "candidate";
    turns.push({ speaker, text: text.trim() });
  }
  return turns.length > 0 ? turns : null;
}
