import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/escrow/fund
 *
 * Charges the client the full amount (candidate rate + 10% fee) via Stripe.
 * Funds are held in StaffVA's Stripe account until release trigger fires.
 *
 * Body: { engagementId, periodId?, milestoneId? }
 *   - For ongoing contracts: provide periodId
 *   - For project contracts: provide milestoneId
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.app_metadata?.role !== "client") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { engagementId, periodId, milestoneId } = await request.json();

    if (!engagementId || (!periodId && !milestoneId)) {
      return NextResponse.json(
        { error: "engagementId and either periodId or milestoneId required" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();

    // Verify engagement belongs to this client
    const { data: engagement } = await admin
      .from("engagements")
      .select("*, clients!inner(user_id, stripe_customer_id)")
      .eq("id", engagementId)
      .single();

    if (!engagement || engagement.clients.user_id !== user.id) {
      return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
    }

    // Check contract is fully executed before allowing escrow funding
    const { data: contract } = await admin
      .from("engagement_contracts")
      .select("status")
      .eq("engagement_id", engagementId)
      .single();

    if (contract && contract.status !== "fully_executed") {
      return NextResponse.json(
        { error: "Contract must be fully signed by both parties before funding escrow" },
        { status: 400 }
      );
    }

    // Get or create Stripe customer
    let customerId = engagement.clients.stripe_customer_id;
    if (!customerId) {
      const customer = await getStripe().customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await admin
        .from("clients")
        .update({ stripe_customer_id: customerId })
        .eq("user_id", user.id);
    }

    let amountUsd: number;
    let description: string;

    if (periodId) {
      // Ongoing contract — fund a payment period
      const { data: period } = await admin
        .from("payment_periods")
        .select("*")
        .eq("id", periodId)
        .eq("engagement_id", engagementId)
        .single();

      if (!period) {
        return NextResponse.json({ error: "Period not found" }, { status: 404 });
      }
      // funded_at is the only reliable "money actually received" signal:
      // payment_periods.status DEFAULTS to 'funded' at insert, so the previous
      // guard (status !== "funded" && funded_at) was inverted and could never
      // block a funded period — letting a client be charged twice for the same
      // period. It only fired for released/refunded rows, i.e. the wrong states.
      if (period.funded_at) {
        return NextResponse.json({ error: "Period already funded" }, { status: 400 });
      }

      amountUsd = Number(engagement.client_total_usd);
      description = `StaffVA — Period ${period.period_start} to ${period.period_end}`;
    } else {
      // Project contract — fund a milestone
      const { data: milestone } = await admin
        .from("milestones")
        .select("*")
        .eq("id", milestoneId)
        .eq("engagement_id", engagementId)
        .single();

      if (!milestone) {
        return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
      }
      if (milestone.status !== "pending") {
        return NextResponse.json({ error: "Milestone not in pending state" }, { status: 400 });
      }

      // Milestone amount + 10% fee
      const fee = Number(milestone.amount_usd) * 0.1;
      amountUsd = Number(milestone.amount_usd) + fee;
      description = `StaffVA — Milestone: ${milestone.title}`;
    }

    // Create Stripe PaymentIntent (immediate capture — funds held in platform account)
    const amountCents = Math.round(amountUsd * 100);

    const paymentIntent = await getStripe().paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: customerId,
      description,
      metadata: {
        engagement_id: engagementId,
        period_id: periodId || "",
        milestone_id: milestoneId || "",
        candidate_rate_usd: engagement.candidate_rate_usd.toString(),
        platform_fee_usd: engagement.platform_fee_usd.toString(),
      },
      automatic_payment_methods: { enabled: true },
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amountUsd,
    });
  } catch (error) {
    console.error("Escrow fund error:", error);
    return NextResponse.json(
      { error: "Failed to create payment" },
      { status: 500 }
    );
  }
}
