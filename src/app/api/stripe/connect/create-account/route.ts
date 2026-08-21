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
 * POST /api/stripe/connect/create-account
 *
 * Authenticated (candidate session required).
 * 1. If candidate already has a stripe_account_id, skip creation.
 * 2. Otherwise, create a Stripe Express account and store the ID.
 * 3. Generate a fresh account_onboarding link and return it.
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
    .select("id, stripe_account_id, email, full_name")
    .eq("user_id", user.id)
    .single();

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  let accountId = candidate.stripe_account_id as string | null;

  // Step 1: Create Express account if none exists
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      capabilities: { transfers: { requested: true } },
      business_type: "individual",
    });

    accountId = account.id;

    await admin
      .from("candidates")
      .update({
        stripe_account_id: accountId,
        payout_status: "onboarding",
      })
      .eq("id", candidate.id);
  }

  // Step 2: Generate a fresh onboarding link
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: "https://staffva.com/candidate/dashboard?payout=refresh",
    return_url: "https://staffva.com/candidate/dashboard?payout=complete",
    type: "account_onboarding",
  });

  await admin
    .from("candidates")
    .update({ stripe_onboarding_url: accountLink.url })
    .eq("id", candidate.id);

  return NextResponse.json({ url: accountLink.url });
}
