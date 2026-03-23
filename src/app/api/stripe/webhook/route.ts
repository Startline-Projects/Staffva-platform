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

    // ---- Interview checkout completed ----

    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const interviewRequestId = session.metadata?.interview_request_id;
      const candidateId = session.metadata?.candidate_id;
      const clientId = session.metadata?.client_id;
      const interviewCount = session.metadata?.interview_count;

      if (interviewRequestId) {
        // Mark request as paid
        await supabase
          .from("interview_requests")
          .update({
            payment_status: "paid",
            stripe_payment_id: session.payment_intent as string,
          })
          .eq("id", interviewRequestId);

        // Get candidate and client details for notification emails
        const { data: candidate } = await supabase
          .from("candidates")
          .select("display_name, full_name, email")
          .eq("id", candidateId)
          .single();

        const { data: client } = await supabase
          .from("clients")
          .select("full_name, email")
          .eq("id", clientId)
          .single();

        if (process.env.RESEND_API_KEY && candidate && client) {
          // Notify admin
          try {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: "StaffVA <noreply@staffva.com>",
                to: "admin@staffva.com",
                subject: `New Interview Request — ${candidate.display_name || candidate.full_name} — ${interviewCount} interview(s)`,
                html: `<div style="font-family: sans-serif; max-width: 500px;">
                  <h2>New Interview Request</h2>
                  <p><strong>Candidate:</strong> ${candidate.full_name} (${candidate.email})</p>
                  <p><strong>Client:</strong> ${client.full_name} (${client.email})</p>
                  <p><strong>Interviews:</strong> ${interviewCount}</p>
                  <p><strong>Amount Paid:</strong> $${((session.amount_total || 0) / 100).toFixed(2)}</p>
                  <p><strong>Expected Delivery:</strong> Within 48 hours</p>
                  <a href="https://staffva.com/admin/candidates" style="display:inline-block;background:#fe6e3e;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Go to Admin Panel</a>
                </div>`,
              }),
            });
          } catch (err) {
            console.error("Failed to notify admin:", err);
          }

          // Confirm to client
          try {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: "StaffVA <noreply@staffva.com>",
                to: client.email,
                subject: `Interview Request Confirmed — ${candidate.display_name || candidate.full_name}`,
                html: `<div style="font-family: sans-serif; max-width: 500px;">
                  <h2>Interview Request Confirmed</h2>
                  <p>Hi ${client.full_name},</p>
                  <p>Your request for ${interviewCount} interview${Number(interviewCount) > 1 ? "s" : ""} with <strong>${candidate.display_name || candidate.full_name}</strong> has been confirmed.</p>
                  <p>Our team will conduct the interview${Number(interviewCount) > 1 ? "s" : ""} and deliver notes within <strong>48 hours</strong>. You will receive an email with the scores and PDF notes when ready.</p>
                  <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
                </div>`,
              }),
            });
          } catch (err) {
            console.error("Failed to confirm to client:", err);
          }
        }
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
