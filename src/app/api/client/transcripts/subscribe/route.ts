import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { hasTranscriptAccess, priceIdFor, type TranscriptInterval } from "@/lib/transcriptAccess";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/client/transcripts/subscribe — start the $10/mo or $50/yr
 * subscription that unlocks interview transcripts.
 *
 * Stripe CHECKOUT, unlike escrow. Escrow funding is a PaymentIntent because it
 * charges a saved card for a specific amount with no recurrence; this is a
 * recurring subscription, which is what Checkout in `mode: 'subscription'` is
 * for — it handles the mandate, the renewal and the card update page. Do not
 * copy the escrow pattern here.
 */
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let interval: TranscriptInterval;
  try {
    const body = await request.json();
    interval = body?.interval === "year" ? "year" : "month";
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const price = priceIdFor(interval);
  if (!price) {
    // Explicit, not a Stripe error surfaced raw. Without the price id
    // configured this is a deployment gap, and saying so beats "something
    // went wrong" while somebody tries to give us money.
    console.error(`[transcripts/subscribe] no price id configured for ${interval}`);
    return NextResponse.json(
      { error: "Transcript access isn't available to buy just yet. Try again shortly." },
      { status: 503 }
    );
  }

  const db = admin();
  const { data: client, error } = await db
    .from("clients")
    .select("id, email, stripe_customer_id, transcript_access_status, transcript_access_until, transcript_access_interval")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[transcripts/subscribe] client lookup failed:", error.message);
    return NextResponse.json({ error: "Could not start checkout." }, { status: 500 });
  }
  if (!client) return NextResponse.json({ error: "Not a client account" }, { status: 403 });

  // Already paid for. Selling a second subscription to someone who cannot use
  // two is the kind of thing that turns into a refund and an apology.
  if (hasTranscriptAccess(client)) {
    return NextResponse.json(
      { error: "You already have transcript access. Manage it from Billing." },
      { status: 409 }
    );
  }

  const stripe = getStripe();

  let customerId = client.stripe_customer_id as string | null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: client.email as string,
      metadata: { client_id: client.id as string },
    });
    customerId = customer.id;
    const { error: saveErr } = await db
      .from("clients").update({ stripe_customer_id: customerId }).eq("id", client.id);
    // Checked: an unsaved customer id means the next visit mints ANOTHER
    // customer, and the client ends up with two Stripe records and a
    // subscription on the one we forgot.
    if (saveErr) {
      console.error("[transcripts/subscribe] could not save customer id:", saveErr.message);
      return NextResponse.json({ error: "Could not start checkout." }, { status: 500 });
    }
  }

  const origin = new URL(request.url).origin;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    success_url: `${origin}/billing?transcripts=on`,
    cancel_url: `${origin}/billing`,
    // Read back by the webhook. client_id is on BOTH the session and the
    // subscription: the session carries it to checkout.session.completed, and
    // subscription_data.metadata carries it onto the subscription object, which
    // is what every later renewal and cancellation event actually contains.
    metadata: { purpose: "transcript_access", client_id: client.id as string, interval },
    subscription_data: {
      metadata: { purpose: "transcript_access", client_id: client.id as string, interval },
    },
  });

  if (!session.url) {
    console.error("[transcripts/subscribe] Stripe returned no checkout url");
    return NextResponse.json({ error: "Could not start checkout." }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
}
