import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/stripe/connect/login-link
 *
 * Authenticated (candidate session required).
 * Generates a Stripe Express dashboard login link for the candidate
 * to resolve account issues (used when payout_status = 'suspended').
 */
export async function POST() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== "candidate") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const admin = getAdminClient();

  const { data: candidate } = await admin
    .from("candidates")
    .select("id, stripe_account_id")
    .eq("user_id", user.id)
    .single();

  if (!candidate?.stripe_account_id) {
    return NextResponse.json({ error: "No Stripe account found" }, { status: 404 });
  }

  const loginLink = await stripe.accounts.createLoginLink(candidate.stripe_account_id);

  return NextResponse.json({ url: loginLink.url });
}
