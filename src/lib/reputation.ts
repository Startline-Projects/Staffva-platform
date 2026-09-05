import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface ReputationBreakdown {
  aiScore: number; // 0-100 raw, contributes 40%
  reviewScore: number; // 0-100 (avg rating * 20), contributes 40%
  completenessScore: number; // 0-100 percentage, contributes 20%
  aiContribution: number; // points contributed
  reviewContribution: number;
  completenessContribution: number;
  totalScore: number;
  tier: string | null;
}

const TIERS: { min: number; label: string }[] = [
  { min: 90, label: "Elite" },
  { min: 80, label: "Top Rated" },
  { min: 70, label: "Rising" },
  { min: 60, label: "Established" },
];

export function getTier(score: number): string | null {
  for (const t of TIERS) {
    if (score >= t.min) return t.label;
  }
  return null;
}

export async function calculateReputationForCandidate(
  candidateId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any
): Promise<ReputationBreakdown> {
  const admin = supabase || getAdminClient();

  // 1. AI overall_score (40% weight)
  //
  // Gated on candidates.ai_interview_passed — the same authority promotion and
  // relisting use — rather than on the interview row's own status.
  //
  // The old predicate was `status = 'completed' AND passed = true`, which
  // matches exactly ONE row in this database. Thirty approved candidates carry
  // ai_interview_passed = true and DO have a graded skills interview scoring
  // 60-78, but those rows sit at status 'failed_technical': our own audio
  // failures, not their answers. They therefore scored 0 on this component, and
  // 12 overall against a tier floor of 60 — unreachable even with perfect
  // reviews, whose ceiling is 56. Collecting reviews without this fix would be
  // collecting data into a system structurally unable to use it.
  const { data: gate } = await admin
    .from("candidates")
    .select("ai_interview_passed")
    .eq("id", candidateId)
    .maybeSingle();

  let aiScore = 0;
  if (gate?.ai_interview_passed) {
    const { data: aiInterview } = await admin
      .from("ai_interviews")
      .select("overall_score")
      .eq("kind", "skills")
      .eq("candidate_id", candidateId)
      .not("overall_score", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    aiScore = aiInterview?.overall_score || 0;
  }

  // 2. Average review rating (40% weight) — 5 stars = 100
  //
  // Read from candidate_reviews_public, never from `reviews` directly. Two
  // reasons, both load-bearing:
  //  - candidate_id is a PARTY, not a subject. Filtering the base table on it
  //    returns the candidate's own outbound rating OF their client as well, and
  //    would fold their opinion of the client into their own score.
  //  - the view applies the reveal rule. This function publishes a DERIVED
  //    value, so an unrevealed rating leaks through arithmetic even while the
  //    row itself is hidden — with a single review, avg x 20 makes the client's
  //    hidden rating exactly recoverable the next time the cron runs.
  const { data: reviews } = await admin
    .from("candidate_reviews_public")
    .select("rating")
    .eq("candidate_id", candidateId);

  let reviewScore = 0;
  if (reviews && reviews.length > 0) {
    const avgRating = reviews.reduce((sum: number, r: { rating: number }) => sum + r.rating, 0) / reviews.length;
    reviewScore = avgRating * 20; // 5 stars * 20 = 100
  }

  // 3. Profile completeness (20% weight)
  const { data: candidate } = await admin
    .from("candidates")
    .select("tagline, tools, work_experience, total_earnings_usd")
    .eq("id", candidateId)
    .single();

  const { count: portfolioCount } = await admin
    .from("portfolio_items")
    .select("*", { count: "exact", head: true })
    .eq("candidate_id", candidateId);

  let completedFields = 0;
  const totalFields = 5;

  if (candidate?.tagline && candidate.tagline.length > 0) completedFields++;
  if ((portfolioCount || 0) > 0) completedFields++;
  if (Array.isArray(candidate?.work_experience) && candidate.work_experience.length > 0) completedFields++;
  if (Array.isArray(candidate?.tools) && candidate.tools.length > 0) completedFields++;
  if ((candidate?.total_earnings_usd || 0) > 0) completedFields++;

  const completenessScore = Math.round((completedFields / totalFields) * 100);

  // Calculate weighted total
  const aiContribution = Math.round(aiScore * 0.4);
  const reviewContribution = Math.round(reviewScore * 0.4);
  const completenessContribution = Math.round(completenessScore * 0.2);
  const totalScore = Math.min(aiContribution + reviewContribution + completenessContribution, 100);

  return {
    aiScore,
    reviewScore: Math.round(reviewScore),
    completenessScore,
    aiContribution,
    reviewContribution,
    completenessContribution,
    totalScore,
    tier: getTier(totalScore),
  };
}

export async function calculateAllReputationScores(): Promise<number> {
  const admin = getAdminClient();

  // Get all approved candidates
  const { data: candidates } = await admin
    .from("candidates")
    .select("id")
    .eq("admin_status", "approved");

  if (!candidates || candidates.length === 0) return 0;

  // Calculate scores for all candidates
  const scores: { id: string; score: number }[] = [];

  for (const c of candidates) {
    const breakdown = await calculateReputationForCandidate(c.id, admin);
    scores.push({ id: c.id, score: breakdown.totalScore });

    // Update the candidate record. Errors are surfaced, not swallowed: a
    // silently failed write here leaves a stale public score with nothing
    // anywhere saying so.
    const { error: writeErr } = await admin
      .from("candidates")
      .update({
        reputation_score: breakdown.totalScore,
        reputation_tier: breakdown.tier,
      })
      .eq("id", c.id);
    if (writeErr) console.error("[reputation] score write failed:", c.id, writeErr.message);
  }

  // Percentile ranks. Equal scores get an EQUAL percentile.
  //
  // This used the row's index in a sorted array, so candidates on an identical
  // score were spread across the range by nothing but sort order — with 25
  // people currently tied on 12, that assigned percentiles from 4 to 90 for the
  // same performance, and the public profile prints "Top N% of platform" from it.
  // MID-RANK, not "at or below". Counting everyone at or below your score gives
  // the whole tie group the best rank in it: with 25 people tied on 12, every
  // one of them scores atOrBelow === ranked.length and the profile prints "Top
  // 1% of platform" for all 25. That is the first fix's bug, not the original
  // one's — the original spread ties across the range by sort order, this one
  // collapsed them all onto the top. Half the tie group counts as below and
  // half as above, which is the standard treatment and the only one that
  // survives a distribution where everybody is equal (it gives 50, not 100).
  const ranked = scores.filter((s) => s.score > 0);
  for (const row of ranked) {
    const below = ranked.filter((o) => o.score < row.score).length;
    const equal = ranked.filter((o) => o.score === row.score).length;
    const percentile = Math.round(((below + equal / 2) / ranked.length) * 100);
    const { error } = await admin
      .from("candidates")
      .update({ reputation_percentile: percentile })
      .eq("id", row.id);
    if (error) console.error("[reputation] percentile write failed:", row.id, error.message);
  }

  // Candidates with score 0 get no percentile
  const zeroScoreIds = scores.filter((s) => s.score === 0).map((s) => s.id);
  if (zeroScoreIds.length > 0) {
    for (const id of zeroScoreIds) {
      await admin
        .from("candidates")
        .update({ reputation_percentile: null, reputation_tier: null })
        .eq("id", id);
    }
  }

  return candidates.length;
}
