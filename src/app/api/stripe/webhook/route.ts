import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

// Use service role client for webhook — no user session available
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Webhook signature verification failed:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const supabase = getAdminClient();

  switch (event.type) {
    // ---- Stripe Identity — ID verification ----

    case "identity.verification_session.verified": {
      const session = event.data.object as {
        id: string;
        metadata?: { candidate_id?: string };
      };
      const candidateId = session.metadata?.candidate_id;

      if (candidateId) {
        await supabase
          .from("candidates")
          .update({ id_verification_status: "passed" })
          .eq("id", candidateId);
      }
      break;
    }

    case "identity.verification_session.requires_input": {
      const session = event.data.object as {
        id: string;
        metadata?: { candidate_id?: string };
      };
      const candidateId = session.metadata?.candidate_id;

      if (candidateId) {
        await supabase
          .from("candidates")
          .update({ id_verification_status: "failed" })
          .eq("id", candidateId);
      }
      break;
    }

    // ---- Escrow payments (v5) ----

    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const engagementId = pi.metadata?.engagement_id;
      const periodId = pi.metadata?.period_id;
      const milestoneId = pi.metadata?.milestone_id;

      if (!engagementId) break;

      const now = new Date().toISOString();

      if (periodId) {
        // Get period to calculate auto-release time (48h after period_end)
        const { data: period } = await supabase
          .from("payment_periods")
          .select("period_end")
          .eq("id", periodId)
          .single();

        const autoRelease = period?.period_end
          ? new Date(new Date(period.period_end).getTime() + 48 * 60 * 60 * 1000).toISOString()
          : null;

        await supabase
          .from("payment_periods")
          .update({
            status: "funded",
            funded_at: now,
            auto_release_at: autoRelease,
          })
          .eq("id", periodId);
      }

      if (milestoneId) {
        await supabase
          .from("milestones")
          .update({ status: "funded", funded_at: now })
          .eq("id", milestoneId);
      }

      // Ensure engagement is active and lock is set
      await supabase
        .from("engagements")
        .update({
          status: "active",
          lock_activated_at: now,
        })
        .eq("id", engagementId)
        .is("lock_activated_at", null);

      break;
    }

    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const engagementId = pi.metadata?.engagement_id;

      if (engagementId) {
        await supabase
          .from("engagements")
          .update({ status: "payment_failed" })
          .eq("id", engagementId);
      }
      break;
    }

    case "charge.refunded": {
      // Dispute refund processed — logged for audit
      const charge = event.data.object as Stripe.Charge;
      console.log(
        `[StaffVA] Refund processed: charge ${charge.id} — $${(charge.amount_refunded / 100).toFixed(2)}`
      );
      break;
    }
  }

  return NextResponse.json({ received: true });
}
