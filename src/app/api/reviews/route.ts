import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET /api/reviews?candidateId=xxx
 *
 * Returns all published reviews for a candidate.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const candidateId = searchParams.get("candidateId");

  if (!candidateId) {
    return NextResponse.json({ error: "candidateId required" }, { status: 400 });
  }

  const admin = getAdminClient();

  const { data: reviews } = await admin
    .from("reviews")
    .select("id, rating, body, submitted_at")
    .eq("candidate_id", candidateId)
    .eq("published", true)
    .order("submitted_at", { ascending: false });

  return NextResponse.json({ reviews: reviews || [] });
}

/**
 * POST /api/reviews
 *
 * Client submits a review for a candidate.
 * Gated: review button only available after 30 days of verified payments.
 *
 * Body: { engagementId, rating (1-5), body? }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.user_metadata?.role !== "client") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { engagementId, rating, body } = await request.json();

    if (!engagementId || !rating || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "engagementId and rating (1-5) required" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();

    // Get client record
    const { data: client } = await admin
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Get engagement and verify ownership
    const { data: engagement } = await admin
      .from("engagements")
      .select("id, client_id, candidate_id, created_at")
      .eq("id", engagementId)
      .eq("client_id", client.id)
      .single();

    if (!engagement) {
      return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
    }

    // Check 30-day eligibility — first released payment must be 30+ days ago
    const { data: releasedPayments } = await admin
      .from("payment_periods")
      .select("released_at")
      .eq("engagement_id", engagementId)
      .eq("status", "released")
      .order("released_at", { ascending: true })
      .limit(1);

    let firstReleaseDate: Date | null = null;

    if (releasedPayments && releasedPayments.length > 0 && releasedPayments[0].released_at) {
      firstReleaseDate = new Date(releasedPayments[0].released_at);
    } else {
      // Check milestones too
      const { data: releasedMilestones } = await admin
        .from("milestones")
        .select("released_at")
        .eq("engagement_id", engagementId)
        .eq("status", "released")
        .order("released_at", { ascending: true })
        .limit(1);

      if (releasedMilestones && releasedMilestones.length > 0 && releasedMilestones[0].released_at) {
        firstReleaseDate = new Date(releasedMilestones[0].released_at);
      }
    }

    if (!firstReleaseDate) {
      return NextResponse.json(
        { error: "No released payments yet — cannot review" },
        { status: 400 }
      );
    }

    const daysSinceFirstRelease = Math.floor(
      (Date.now() - firstReleaseDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceFirstRelease < 30) {
      return NextResponse.json(
        {
          error: `Review available in ${30 - daysSinceFirstRelease} days (30 days after first payment)`,
        },
        { status: 400 }
      );
    }

    // Check if already reviewed this engagement
    const { count } = await admin
      .from("reviews")
      .select("*", { count: "exact", head: true })
      .eq("engagement_id", engagementId)
      .eq("client_id", client.id);

    if (count && count > 0) {
      return NextResponse.json(
        { error: "You have already reviewed this engagement" },
        { status: 400 }
      );
    }

    // Create review
    const eligibleAt = new Date(firstReleaseDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    const { data: review, error: insertError } = await admin
      .from("reviews")
      .insert({
        engagement_id: engagementId,
        client_id: client.id,
        candidate_id: engagement.candidate_id,
        rating,
        body: body || null,
        eligible_at: eligibleAt.toISOString(),
        published: true,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ review });
  } catch (error) {
    console.error("Submit review error:", error);
    return NextResponse.json({ error: "Failed to submit review" }, { status: 500 });
  }
}
