import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-04-30.basil",
});

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const supabaseAuth = await createServerClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();

  if (!user || user.user_metadata?.role !== "client") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { candidateId, interviewCount } = await req.json();

  if (!candidateId || ![1, 2].includes(interviewCount)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Get client record
  const { data: client } = await supabase
    .from("clients")
    .select("id, email, full_name, stripe_customer_id")
    .eq("user_id", user.id)
    .single();

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  // Get candidate info
  const { data: candidate } = await supabase
    .from("candidates")
    .select("id, display_name, full_name")
    .eq("id", candidateId)
    .single();

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  // Check for existing pending/paid request
  const { data: existingRequest } = await supabase
    .from("interview_requests")
    .select("id, payment_status, interviews_requested")
    .eq("candidate_id", candidateId)
    .eq("client_id", client.id)
    .in("payment_status", ["pending", "paid"])
    .single();

  if (existingRequest) {
    return NextResponse.json({
      error: `You already have a ${existingRequest.payment_status} interview request for this candidate`,
    }, { status: 400 });
  }

  const amount = interviewCount === 1 ? 5000 : 9000; // $50 or $90 in cents
  const description = interviewCount === 1
    ? `StaffVA Interview (1x) — ${candidate.display_name || candidate.full_name}`
    : `StaffVA Interview (2x) — ${candidate.display_name || candidate.full_name}`;

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

  // Create the interview request record (pending payment)
  const { data: interviewRequest } = await supabase
    .from("interview_requests")
    .insert({
      candidate_id: candidateId,
      client_id: client.id,
      interviews_requested: interviewCount,
      amount_paid: amount,
      payment_status: "pending",
    })
    .select()
    .single();

  // Create Stripe Checkout session
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: description,
            description: interviewCount === 1
              ? "One 20-minute structured interview. Notes added to profile. Emailed to you."
              : "Two separate interviews for deeper evaluation. Both sets of notes emailed to you.",
          },
          unit_amount: amount,
        },
        quantity: 1,
      },
    ],
    metadata: {
      interview_request_id: interviewRequest?.id || "",
      candidate_id: candidateId,
      client_id: client.id,
      interview_count: interviewCount.toString(),
    },
    success_url: `${siteUrl}/candidate/${candidateId}?interview=requested`,
    cancel_url: `${siteUrl}/candidate/${candidateId}?interview=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
