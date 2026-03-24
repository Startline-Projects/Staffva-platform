import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST — create a Stripe Checkout session for a service package purchase
export async function POST(request: Request) {
  const serverSupabase = await createServerSupabase();
  const { data: { user } } = await serverSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = getAdminClient();

  // Get client record
  const { data: client } = await supabase
    .from("clients")
    .select("id, email, full_name, stripe_customer_id")
    .eq("user_id", user.id)
    .single();

  if (!client) {
    return NextResponse.json({ error: "Client account not found" }, { status: 404 });
  }

  const body = await request.json();
  const { packageId, requirements } = body;

  if (!packageId) {
    return NextResponse.json({ error: "Package ID required" }, { status: 400 });
  }

  if (!requirements || requirements.length < 20) {
    return NextResponse.json({ error: "Requirements must be at least 20 characters" }, { status: 400 });
  }

  if (requirements.length > 500) {
    return NextResponse.json({ error: "Requirements must be 500 characters or less" }, { status: 400 });
  }

  // Fetch the service package
  const { data: pkg } = await supabase
    .from("service_packages")
    .select("*, candidates(id, display_name)")
    .eq("id", packageId)
    .eq("status", "active")
    .single();

  if (!pkg) {
    return NextResponse.json({ error: "Service package not found or not active" }, { status: 404 });
  }

  // Check max concurrent orders
  const { count: activeOrders } = await supabase
    .from("service_orders")
    .select("id", { count: "exact" })
    .eq("service_package_id", packageId)
    .in("status", ["pending", "in_progress", "submitted"]);

  if ((activeOrders || 0) >= pkg.max_concurrent_orders) {
    return NextResponse.json({ error: "This service is currently at maximum capacity. Please try again later." }, { status: 400 });
  }

  // Calculate pricing
  const packagePrice = Number(pkg.price_usd);
  const platformFee = Math.round(packagePrice * 10) / 100; // 10% fee
  const totalAmount = packagePrice + platformFee;
  const totalCents = Math.round(totalAmount * 100);

  // Create or get Stripe customer
  let stripeCustomerId = client.stripe_customer_id;

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: client.email,
      name: client.full_name,
      metadata: { client_id: client.id },
    });
    stripeCustomerId = customer.id;

    await supabase
      .from("clients")
      .update({ stripe_customer_id: stripeCustomerId })
      .eq("id", client.id);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";
  const candidateData = pkg.candidates as { id: string; display_name: string };

  // Create Stripe Checkout session
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: pkg.title,
            description: `Service by ${candidateData.display_name} — Delivery in ${pkg.delivery_days} days`,
          },
          unit_amount: totalCents,
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    success_url: `${siteUrl}/services/order-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/candidate/${candidateData.id}?cancelled=true`,
    metadata: {
      type: "service_order",
      package_id: packageId,
      client_id: client.id,
      candidate_id: pkg.candidate_id,
      package_price: packagePrice.toString(),
      platform_fee: platformFee.toString(),
      total_amount: totalAmount.toString(),
      requirements,
    },
  });

  // Create a pending order record
  const { data: order, error: orderError } = await supabase
    .from("service_orders")
    .insert({
      service_package_id: packageId,
      client_id: client.id,
      candidate_id: pkg.candidate_id,
      stripe_payment_intent_id: session.payment_intent as string || session.id,
      amount_paid_usd: totalAmount,
      platform_fee_usd: platformFee,
      candidate_amount_usd: packagePrice,
      status: "pending",
      client_requirements: requirements,
    })
    .select()
    .single();

  if (orderError) {
    return NextResponse.json({ error: orderError.message }, { status: 500 });
  }

  return NextResponse.json({
    checkoutUrl: session.url,
    orderId: order.id,
    sessionId: session.id,
  });
}
