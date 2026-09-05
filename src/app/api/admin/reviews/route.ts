import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * Staff view of every review, and the only way to take one down.
 *
 * This is the counterpart to "permanent and public". `published` existed as a
 * column with no writer and no reader — so a forged, abusive or mistaken review
 * would have had no removal path at all, on a table that attaches permanent
 * reputation to a real person's livelihood. Nothing else in the product may
 * write it: submit_review always sets it true, and the browser holds no UPDATE
 * grant on reviews.
 *
 * Reachable by admin and recruiting_manager — the (admin) layout already admits
 * both, and the manager is the only staff role that has signed in recently.
 */

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function requireStaff() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const role = user.app_metadata?.role;
  if (role !== "admin" && role !== "recruiting_manager") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const gate = await requireStaff();
  if (gate.error) return gate.error;

  // Reads the base table on purpose: staff need to see unrevealed and
  // unpublished rows, which is exactly what the two views hide.
  const { data, error } = await admin()
    .from("reviews")
    .select(
      "id, engagement_id, direction, rating, body, submitted_at, reveal_at, published, candidate_id, client_id"
    )
    .order("submitted_at", { ascending: false });

  if (error) {
    console.error("[admin/reviews] list failed:", error.message);
    return NextResponse.json({ error: "Could not load reviews." }, { status: 500 });
  }
  return NextResponse.json({ reviews: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireStaff();
  if (gate.error) return gate.error;

  const body = await req.json().catch(() => ({}));
  const reviewId = typeof body.reviewId === "string" ? body.reviewId : "";
  const published = body.published;

  if (!reviewId) return NextResponse.json({ error: "reviewId required" }, { status: 400 });
  if (typeof published !== "boolean") {
    return NextResponse.json({ error: "published must be true or false" }, { status: 400 });
  }

  const { data: updated, error } = await admin()
    .from("reviews")
    .update({ published })
    .eq("id", reviewId)
    .select("id, published")
    .maybeSingle();

  if (error) {
    console.error("[admin/reviews] update failed:", error.message);
    return NextResponse.json({ error: "Could not update that review." }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: "Review not found" }, { status: 404 });

  return NextResponse.json({ review: updated });
}
