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
  const { data: aiInterview } = await admin
    .from("ai_interviews")
    .select("overall_score")
    .eq("candidate_id", candidateId)
    .eq("status", "completed")
    .eq("passed", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const aiScore = aiInterview?.overall_score || 0;

  // 2. Average review rating (40% weight) — 5 stars = 100
  const { data: reviews } = await admin
    .from("reviews")
    .select("rating")
    .eq("candidate_id", candidateId)
    .eq("published", true);

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

    // Update the candidate record
    await admin
      .from("candidates")
      .update({
        reputation_score: breakdown.totalScore,
        reputation_tier: breakdown.tier,
      })
      .eq("id", c.id);
  }

  // Calculate percentile ranks
  const sortedScores = scores
    .filter((s) => s.score > 0)
    .sort((a, b) => a.score - b.score);

  for (let i = 0; i < sortedScores.length; i++) {
    const percentile = Math.round(((i + 1) / sortedScores.length) * 100);
    await admin
      .from("candidates")
      .update({ reputation_percentile: percentile })
      .eq("id", sortedScores[i].id);
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
