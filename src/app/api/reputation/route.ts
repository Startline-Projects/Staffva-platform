import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { calculateReputationForCandidate } from "@/lib/reputation";

/**
 * GET /api/reputation
 *
 * Returns the reputation breakdown for the authenticated candidate.
 */
export async function GET() {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: candidate } = await admin
      .from("candidates")
      .select("id, reputation_score, reputation_tier, reputation_percentile")
      .eq("user_id", user.id)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    const breakdown = await calculateReputationForCandidate(candidate.id, admin);

    return NextResponse.json({
      ...breakdown,
      percentile: candidate.reputation_percentile,
    });
  } catch (error) {
    console.error("Reputation API error:", error);
    return NextResponse.json({ error: "Failed to load reputation" }, { status: 500 });
  }
}
