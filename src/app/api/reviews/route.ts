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

  // Reads candidate_reviews_public, never `reviews`. That view applies the
  // reveal rule AND the direction filter — filtering the base table on
  // candidate_id would return the candidate's own outbound review of their
  // client and render it as a review OF them, since both halves of a pair carry
  // the same candidate_id.
  const { data: reviews } = await admin
    .from("candidate_reviews_public")
    .select("id, rating, body, submitted_at")
    .eq("candidate_id", candidateId)
    .order("submitted_at", { ascending: false });

  return NextResponse.json({ reviews: reviews || [] });
}

/**
 * POST /api/reviews
 *
 * Either side of an engagement submits their half of the pair.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { engagementId, rating, body } = await request.json();

    // rating must be an INTEGER 1-5. Without the type test a string like "abc"
    // passes (NaN comparisons are always false) and hits the database CHECK as
    // a 500 rather than a clean 400. The RPC checks it too; this is the cheap
    // early exit with a readable message.
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Rating must be a whole number from 1 to 5." }, { status: 400 });
    }
    if (typeof engagementId !== "string" || !engagementId) {
      return NextResponse.json({ error: "engagementId required" }, { status: 400 });
    }
    if (body != null && (typeof body !== "string" || body.length > 2000)) {
      return NextResponse.json({ error: "Keep your review under 2000 characters." }, { status: 400 });
    }

    // Everything else is the RPC's job, deliberately.
    //
    // This route used to check ownership, a 30-day window, and a duplicate
    // count before inserting directly — four rules in TypeScript, on a table the
    // browser could also write. submit_review() now derives the DIRECTION from
    // who is calling (so nothing in the body can name the subject), enforces
    // eligibility from released money, and anchors both halves of a pair to one
    // shared reveal instant. The role check is gone from here too: candidates
    // call the same route now, and the RPC decides which side they are.
    const { data: reviewId, error } = await supabase.rpc("submit_review", {
      p_engagement_id: engagementId,
      p_rating: rating,
      p_body: typeof body === "string" ? body : null,
    });

    if (error) {
      // 23505 = the one-per-side unique index. 42501 = every authorization and
      // eligibility refusal the RPC raises.
      if (error.code === "23505") {
        return NextResponse.json({ error: "You've already reviewed this engagement." }, { status: 409 });
      }
      if (error.code === "42501") {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      console.error("[reviews] submit failed:", error.message);
      return NextResponse.json({ error: "We couldn't save your review." }, { status: 500 });
    }

    return NextResponse.json({ reviewId });
  } catch (err) {
    console.error("Review submit error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/reviews — withdraw your own review, only before it is revealed.
 *
 * review_is_revealed() turns true the instant the other side submits, so once a
 * pair is complete neither party can pull theirs after reading the other's.
 */
export async function DELETE(request: Request) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { engagementId } = await request.json();
    if (typeof engagementId !== "string" || !engagementId) {
      return NextResponse.json({ error: "engagementId required" }, { status: 400 });
    }

    const { data: withdrawn, error } = await supabase.rpc("withdraw_review", {
      p_engagement_id: engagementId,
    });
    if (error) {
      if (error.code === "42501") {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      console.error("[reviews] withdraw failed:", error.message);
      return NextResponse.json({ error: "We couldn't withdraw your review." }, { status: 500 });
    }
    if (!withdrawn) {
      return NextResponse.json(
        { error: "Both reviews are in, so this can no longer be withdrawn." },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Review withdraw error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
