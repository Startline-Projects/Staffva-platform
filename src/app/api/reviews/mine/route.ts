import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * GET /api/reviews/mine — every engagement the caller is a party to, with the
 * state of both halves of its review pair.
 *
 * Deliberately one call to my_review_state() rather than a query the caller
 * composes. Eligibility ("has any money actually been released?") and the
 * reveal rule live in SQL, in migrations 00196 and 00197, and both sides read
 * them through the same function — so the client's dashboard and the
 * candidate's cannot come to different conclusions about whether a review is
 * open, submitted, or visible.
 *
 * Note the caller's own client is used, NOT the service role. The function is
 * SECURITY DEFINER but resolves auth.uid() internally: with the service role
 * there is no auth.uid(), so this would return nothing rather than everything.
 * That is the safe direction to fail, and it is why no admin client appears here.
 */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("my_review_state");
  if (error) {
    console.error("[reviews/mine] failed:", error.message);
    return NextResponse.json({ error: "Could not load your reviews." }, { status: 500 });
  }

  return NextResponse.json({ engagements: data ?? [] });
}
