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
    let existingIntentId: string | null = null;

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

      // The pause clause stops NEW periods, not pay for work already done: a
      // period that STARTED before the pause stays fundable — including after
      // a 30-day pause-out completes the engagement, which would otherwise
      // strand it permanently unpayable. Periods starting at/after the pause
      // wait for a resume. (period_start is a DATE; compare in dates.)
      if (
        engagement.paused_at &&
        String(period.period_start) >= String(engagement.paused_at).slice(0, 10)
      ) {
        return NextResponse.json(
          { error: "This engagement is paused — resume it before funding this period." },
          { status: 409 }
        );
      }

      existingIntentId = period.stripe_payment_intent_id || null;
      // Hourly-basis engagements charge from the PERIOD's own amount + the 10%
      // fee — client_total_usd is the full-month estimate, and the final
      // period of a 14-day notice clamps short of a month: charging the full
      // month against a pro-rated payout would have the platform silently
      // keeping the difference (the step-18 money bug's shape, reversed).
      // Legacy cycle-amount engagements keep client_total_usd — for them it
      // IS the per-cycle total.
      const hourlyBasis = engagement.payment_cycle == null && engagement.weekly_hours != null;

      // A pending period created BEFORE notice landed still spans the full
      // month. Re-clamp at funding time: charging the stale full amount for a
      // period the engagement outlives by days would over-collect from the
      // client and over-pay past the termination date the clause defines.
      if (hourlyBasis && engagement.ends_at) {
        const endsDate = new Date(String(engagement.ends_at).slice(0, 10));
        const pStart = new Date(period.period_start);
        const pEnd = new Date(period.period_end);
        if (pStart >= endsDate) {
          return NextResponse.json(
            { error: "This engagement ends before this period starts — nothing to fund." },
            { status: 409 }
          );
        }
        if (pEnd > endsDate) {
          const fraction =
            (endsDate.getTime() - pStart.getTime()) / (pEnd.getTime() - pStart.getTime());
          const clamped =
            Math.round(Number(period.amount_usd) * fraction * 100) / 100;
          const { data: reclamped } = await admin
            .from("payment_periods")
            .update({
              period_end: endsDate.toISOString().split("T")[0],
              amount_usd: clamped,
            })
            .eq("id", periodId)
            .is("funded_at", null)
            .select("amount_usd")
            .maybeSingle();
          if (!reclamped) {
            return NextResponse.json({ error: "Period already funded" }, { status: 400 });
          }
          period.amount_usd = reclamped.amount_usd;
        }
      }

      amountUsd = hourlyBasis
        ? Math.round(Number(period.amount_usd) * 1.1 * 100) / 100
        : Number(engagement.client_total_usd);
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
      // Milestones are funded BEFORE the work happens, so a pause blocks them
      // outright — there is no pre-pause work to pay for.
      if (engagement.paused_at) {
        return NextResponse.json(
          { error: "This engagement is paused — resume it before funding a milestone." },
          { status: 409 }
        );
      }

      existingIntentId = milestone.stripe_payment_intent_id || null;
      // Milestone amount + 10% fee
      const fee = Number(milestone.amount_usd) * 0.1;
      amountUsd = Number(milestone.amount_usd) + fee;
      description = `StaffVA — Milestone: ${milestone.title}`;
    }

    const amountCents = Math.round(amountUsd * 100);

    // ONE PaymentIntent per fundable row, ever. Two tabs, a closed-and-
    // reopened modal, or a click during the webhook window must all land on
    // the same intent — Stripe guarantees a single intent can only succeed
    // once, which is the double-charge protection no funded_at check can
    // give (funded_at is written asynchronously by the webhook).
    if (existingIntentId) {
      try {
        const existing = await getStripe().paymentIntents.retrieve(existingIntentId);
        if (existing.status === "succeeded" || existing.status === "processing") {
          return NextResponse.json(
            { error: "This payment was already made (or is settling) — nothing more to pay." },
            { status: 409 }
          );
        }
        if (existing.status !== "canceled") {
          return NextResponse.json({
            clientSecret: existing.client_secret,
            paymentIntentId: existing.id,
            amountUsd,
          });
        }
        // canceled → fall through and mint a fresh intent
      } catch {
        // Unretrievable id (deleted test-mode data, wrong account) — mint anew.
      }
    }

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

    // Persist the intent id BEFORE handing out the client secret; if the
    // write fails, cancel the intent rather than leave an unrecorded one
    // that a reopened modal could double-pay against.
    const table = periodId ? "payment_periods" : "milestones";
    const { error: recordError } = await admin
      .from(table)
      .update({ stripe_payment_intent_id: paymentIntent.id })
      .eq("id", (periodId || milestoneId) as string);
    if (recordError) {
      await getStripe().paymentIntents.cancel(paymentIntent.id).catch(() => {});
      return NextResponse.json({ error: "Failed to create payment" }, { status: 500 });
    }

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
