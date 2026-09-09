import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/client/transcripts/manage — open Stripe's billing portal.
 *
 * Cancelling, changing between monthly and yearly, and updating the card all
 * happen there rather than in bespoke screens here. That is not laziness: a
 * "Cancel" button of our own would have to keep our copy of the subscription
 * state in step with Stripe's on every edge (proration, trials, failed
 * renewals, disputes), and the portal is the one surface that cannot drift
 * from what Stripe actually believes.
 */
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = admin();
  const { data: client, error } = await db
    .from("clients")
    .select("id, stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[transcripts/manage] client lookup failed:", error.message);
    return NextResponse.json({ error: "Could not open billing." }, { status: 500 });
  }
  if (!client) return NextResponse.json({ error: "Not a client account" }, { status: 403 });
  if (!client.stripe_customer_id) {
    return NextResponse.json({ error: "You don't have a subscription to manage." }, { status: 404 });
  }

  const origin = new URL(request.url).origin;
  try {
    const portal = await getStripe().billingPortal.sessions.create({
      customer: client.stripe_customer_id as string,
      return_url: `${origin}/billing`,
    });
    return NextResponse.json({ url: portal.url });
  } catch (err) {
    // The portal needs its configuration saved once in the Stripe dashboard.
    // Until that is done Stripe raises here, and a raw 500 would look like our
    // bug rather than a setting nobody has switched on.
    console.error("[transcripts/manage] portal session failed:", err);
    return NextResponse.json(
      { error: "We couldn't open the billing portal. Email support@staffva.com and we'll sort it." },
      { status: 502 }
    );
  }
}
