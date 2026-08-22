import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
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

  // Try platform secret first, then Connect secret.
  // Two Stripe webhook endpoints point here — each has its own signing secret.
  const secrets = [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
  ].filter(Boolean) as string[];

  let event: Stripe.Event | null = null;
  for (const secret of secrets) {
    try {
      event = stripe.webhooks.constructEvent(body, signature, secret);
      break;
    } catch {
      // Try next secret
    }
  }

  if (!event) {
    console.error("Webhook signature verification failed against all configured secrets");
    return NextResponse.json({ error: "Webhook signature verification failed" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Log the webhook event. The (provider, event_id) unique index makes this
  // insert fail on a redelivery, which is our idempotency signal: Stripe
  // delivers at-least-once and retries slow responses, and several handlers
  // below are not safe to run twice (e.g. payment_intent.succeeded would revert
  // an already-released period and re-arm a second payout).
  const { data: logEntry, error: logError } = await supabase
    .from("webhook_log")
    .insert({
      provider: "stripe",
      event_type: event.type,
      event_id: event.id,
      payload: JSON.parse(JSON.stringify(event.data.object)),
      received_at: new Date().toISOString(),
      processed: false,
    })
    .select("id")
    .single();

  // 23505 = unique_violation → we have seen this event before. Ack with 200 so
  // Stripe stops retrying, and do not re-run the side effects.
  if (logError?.code === "23505") {
    console.log(`[stripe webhook] duplicate event ${event.id} (${event.type}) — already processed, skipping`);
    return NextResponse.json({ received: true, duplicate: true });
  }

  const logId = logEntry?.id;

  try {

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

        // Check if the candidate was flagged by the anti-cheat system during the test
        const { data: candidate } = await supabase
          .from("candidates")
          .select("email, display_name, full_name, anticheat_lockout_triggered, anticheat_lockout_reason")
          .eq("id", candidateId)
          .single();

        if (candidate?.anticheat_lockout_triggered) {
          // Apply the 7-day lockout now that identity is confirmed
          const lockoutUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          const returnDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          const formattedReturnDate = returnDate.toLocaleDateString("en-US", {
            day: "numeric",
            month: "long",
            year: "numeric",
          });

          await supabase
            .from("candidates")
            .update({
              test_lockout_until: lockoutUntil,
              test_lockout_notified: false,
              english_mc_score: null,
              english_comprehension_score: null,
              voice_recording_1_url: null,
              voice_recording_2_url: null,
              admin_status: "active",
              identity_session_id: session.id,
            })
            .eq("id", candidateId);

          // Send lockout email
          if (process.env.RESEND_API_KEY && candidate) {
            const isFourStrikes = candidate.anticheat_lockout_reason === "four_strikes";
            const emailBody = isFourStrikes
              ? `During your English assessment, our system detected that you left the test screen 4 or more times. To protect the integrity of our vetting process, your application has been paused for 7 days. You may return on ${formattedReturnDate} to retake the assessment from the beginning. We take the quality of our candidate pool seriously — every professional on StaffVA earned their place.`
              : `During your English assessment, our system detected that you were away from the test screen for more than 10 seconds. To protect the integrity of our vetting process, your application has been paused for 7 days. You may return on ${formattedReturnDate} to retake the assessment from the beginning. We take the quality of our candidate pool seriously — every professional on StaffVA earned their place.`;

            try {
              await sendEmail({
                  from: "StaffVA <notifications@staffva.com>",
                  to: candidate.email,
                  subject: "Your application has been paused for 7 days",
                  html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                    <h2 style="color:#1C1B1A;">Application Paused</h2>
                    <p style="color:#444;font-size:14px;">Hi ${candidate.display_name || candidate.full_name},</p>
                    <p style="color:#444;font-size:14px;line-height:1.6;">${emailBody}</p>
                    <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
                  </div>`,
                });
            } catch { /* silent */ }
          }

          // Check for duplicate identity against other locked-out candidates.
          // Flag in verified_identities if a match exists.
          const { data: existingIdentity } = await supabase
            .from("verified_identities")
            .select("candidate_id")
            .eq("stripe_verification_session_id", session.id)
            .neq("candidate_id", candidateId)
            .maybeSingle();

          if (existingIdentity) {
            await supabase
              .from("verified_identities")
              .update({
                flagged_for_review: true,
                review_reason: "anticheat_duplicate",
              })
              .eq("stripe_verification_session_id", session.id);
          }

          break;
        }

        // No anti-cheat flag — send the normal success email
        if (process.env.RESEND_API_KEY && candidate) {
          try {
            await sendEmail({
                from: "StaffVA <notifications@staffva.com>",
                to: candidate.email,
                subject: "ID Verification Passed — Continue Your Application",
                html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                  <h2 style="color:#1C1B1A;">ID Verification Complete</h2>
                  <p style="color:#444;font-size:14px;">Hi ${candidate.display_name || candidate.full_name},</p>
                  <p style="color:#444;font-size:14px;line-height:1.6;">Your identity has been successfully verified. You can now continue building your profile on StaffVA.</p>
                  <a href="https://staffva.com/apply" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Continue Application</a>
                  <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
                </div>`,
              });
          } catch { /* silent */ }
        }
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

        // Send failure email
        if (process.env.RESEND_API_KEY) {
          const { data: candidate } = await supabase
            .from("candidates")
            .select("email, display_name, full_name")
            .eq("id", candidateId)
            .single();

          if (candidate) {
            try {
              await sendEmail({
                  from: "StaffVA <notifications@staffva.com>",
                  to: candidate.email,
                  subject: "ID Verification Could Not Be Completed",
                  html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                    <h2 style="color:#1C1B1A;">ID Verification Update</h2>
                    <p style="color:#444;font-size:14px;">Hi ${candidate.display_name || candidate.full_name},</p>
                    <p style="color:#444;font-size:14px;line-height:1.6;">Unfortunately, your identity verification could not be completed. This may be due to an unclear photo, mismatched information, or an unsupported document type.</p>
                    <p style="color:#444;font-size:14px;line-height:1.6;">Your application has been paused. If you believe this is an error, please contact our support team and we will assist you.</p>
                    <a href="mailto:support@staffva.com" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Contact Support</a>
                    <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
                  </div>`,
                });
            } catch { /* silent */ }
          }
        }
      }
      break;
    }

    // Stripe Identity — manual review (processing)
    case "identity.verification_session.processing": {
      const session = event.data.object as {
        id: string;
        metadata?: { candidate_id?: string };
      };
      const candidateId = session.metadata?.candidate_id;

      if (candidateId) {
        await supabase
          .from("candidates")
          .update({
            id_verification_status: "manual_review",
            id_verification_submitted_at: new Date().toISOString(),
          })
          .eq("id", candidateId);

        // Send manual review email to candidate
        if (process.env.RESEND_API_KEY) {
          const { data: candidate } = await supabase
            .from("candidates")
            .select("email, display_name, full_name")
            .eq("id", candidateId)
            .single();

          if (candidate) {
            try {
              await sendEmail({
                  from: "StaffVA <notifications@staffva.com>",
                  to: candidate.email,
                  subject: "Your ID Verification Is Under Review",
                  html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                    <h2 style="color:#1C1B1A;">ID Verification Under Review</h2>
                    <p style="color:#444;font-size:14px;">Hi ${candidate.display_name || candidate.full_name},</p>
                    <p style="color:#444;font-size:14px;line-height:1.6;">Your identity verification has been submitted and is currently under manual review. This typically takes up to <strong>48 hours</strong>.</p>
                    <p style="color:#444;font-size:14px;line-height:1.6;">You can continue viewing your application progress in your dashboard while we process your verification. We will notify you by email once it is resolved.</p>
                    <a href="https://staffva.com/candidate/dashboard" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">View My Dashboard</a>
                    <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
                  </div>`,
                });
            } catch { /* silent */ }
          }
        }
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
            await sendEmail({
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
              });
          } catch (err) {
            console.error("Failed to notify admin:", err);
          }

          // Confirm to client
          try {
            await sendEmail({
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
          .eq("id", periodId)
          // Compare-and-swap: only the first funding wins. Without this a
          // redelivered event (or a reconcile pass) would rewrite an already
          // RELEASED period back to 'funded', re-arming the release path — a
          // second Stripe transfer and a second earnings increment.
          .is("funded_at", null);
      }

      if (milestoneId) {
        await supabase
          .from("milestones")
          .update({ status: "funded", funded_at: now })
          .eq("id", milestoneId)
          // Only a pending milestone may transition to funded — never a
          // released/completed one.
          .eq("status", "pending");
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
      const charge = event.data.object as Stripe.Charge;
      const refundedUsd = (charge.amount_refunded / 100).toFixed(2);

      // Previously this only logged, so a refunded period/milestone stayed
      // 'funded' forever — still shown as escrowed and still eligible for
      // auto-release, i.e. we could pay the candidate for money we had already
      // returned to the client.
      const paymentIntentId =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;

      if (!paymentIntentId) {
        console.error(`[StaffVA] Refund ${charge.id} ($${refundedUsd}) has no payment_intent — cannot map to a record`);
        break;
      }

      // The period/milestone ids live on the PaymentIntent metadata set in
      // api/escrow/fund; the Charge does not carry them.
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      const periodId = pi.metadata?.period_id || null;
      const milestoneId = pi.metadata?.milestone_id || null;

      const table = periodId ? "payment_periods" : milestoneId ? "milestones" : null;
      const recordId = periodId || milestoneId;

      if (!table || !recordId) {
        console.error(`[StaffVA] Refund ${charge.id} ($${refundedUsd}) — PaymentIntent ${paymentIntentId} has no period_id/milestone_id metadata`);
        break;
      }

      const { data: record } = await supabase
        .from(table)
        .select("id, status")
        .eq("id", recordId)
        .maybeSingle();

      if (!record) {
        console.error(`[StaffVA] Refund ${charge.id} — ${table}/${recordId} not found`);
        break;
      }

      if (record.status === "released") {
        // The candidate has already been paid. Reversing that is a manual
        // decision (clawback / negative balance), never something to automate
        // from a webhook.
        console.error(
          `[StaffVA Refund Alert] MANUAL REVIEW REQUIRED — ${table}/${recordId} was already RELEASED to the candidate but the client was refunded $${refundedUsd} (charge ${charge.id}). Funds must be recovered manually.`
        );
        break;
      }

      // Not yet paid out: mark refunded so it stops showing as escrowed and can
      // no longer be auto-released.
      await supabase
        .from(table)
        .update({ status: "refunded" })
        .eq("id", recordId)
        .neq("status", "released");

      console.log(`[StaffVA] Refund processed: charge ${charge.id} — $${refundedUsd} — ${table}/${recordId} marked refunded`);
      break;
    }

    // ---- Stripe Connect — account updated ----
    // Fires when a connected Express account's details change.
    // Requires this webhook endpoint to be configured for "Connect events"
    // in the Stripe Dashboard (same signing secret is used).

    // ---- Client subscriptions ----
    // Without these the paid-messaging gate could never open: nothing ever set
    // clients.subscription_status, so every client failed the `=== "active"`
    // check even after paying.
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;

      // Stripe marks the row canceled on deletion regardless of the status it
      // reports; otherwise mirror Stripe's own status (active, trialing,
      // past_due, unpaid, incomplete, ...).
      const status =
        event.type === "customer.subscription.deleted"
          ? "canceled"
          : subscription.status;

      const periodEnd = (subscription as unknown as { current_period_end?: number })
        .current_period_end;

      const update: Record<string, unknown> = {
        subscription_status: status,
        stripe_subscription_id: subscription.id,
        subscription_current_period_end: periodEnd
          ? new Date(periodEnd * 1000).toISOString()
          : null,
      };

      // Prefer the id we set in subscription_data.metadata at checkout; fall
      // back to the customer id we already store on the client row.
      const supabaseUserId = subscription.metadata?.supabase_user_id;
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id;

      if (supabaseUserId) {
        await supabase.from("clients").update(update).eq("user_id", supabaseUserId);
      } else if (customerId) {
        await supabase.from("clients").update(update).eq("stripe_customer_id", customerId);
      } else {
        console.error(
          `[stripe webhook] ${event.type} ${subscription.id} — no supabase_user_id metadata and no customer id; cannot map to a client`
        );
      }

      break;
    }

    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      const connectedAccountId = account.id;

      const { data: candidate } = await supabase
        .from("candidates")
        .select("id, email, full_name, display_name")
        .eq("stripe_account_id", connectedAccountId)
        .maybeSingle();

      if (!candidate) break;

      const detailsSubmitted = account.details_submitted;
      const chargesEnabled = account.charges_enabled;
      const disabledReason = account.requirements?.disabled_reason;

      if (detailsSubmitted && chargesEnabled) {
        await supabase
          .from("candidates")
          .update({
            stripe_onboarding_complete: true,
            payout_status: "active",
          })
          .eq("id", candidate.id);

        if (process.env.RESEND_API_KEY) {
          try {
            await sendEmail({
                from: "StaffVA <notifications@staffva.com>",
                to: candidate.email,
                subject: "Your payout account is active — you're ready to get paid",
                html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                  <h2 style="color:#1C1B1A;">Payout Account Active</h2>
                  <p style="color:#444;font-size:14px;">Hi ${candidate.display_name || candidate.full_name},</p>
                  <p style="color:#444;font-size:14px;line-height:1.6;">Your Stripe payout account is now fully verified and active. When your escrow releases, payments will be sent directly to your connected bank account.</p>
                  <p style="color:#444;font-size:14px;line-height:1.6;">Transfer fees are deducted by Stripe from your payout — your agreed rate with clients is what they pay.</p>
                  <a href="https://staffva.com/candidate/dashboard" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Go to Dashboard</a>
                  <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
                </div>`,
              });
          } catch { /* silent */ }
        }
      } else if (disabledReason) {
        await supabase
          .from("candidates")
          .update({ payout_status: "suspended" })
          .eq("id", candidate.id);

        if (process.env.RESEND_API_KEY) {
          try {
            await sendEmail({
                from: "StaffVA <notifications@staffva.com>",
                to: candidate.email,
                subject: "Action required — your payout account needs attention",
                html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                  <h2 style="color:#1C1B1A;">Payout Account Needs Attention</h2>
                  <p style="color:#444;font-size:14px;">Hi ${candidate.display_name || candidate.full_name},</p>
                  <p style="color:#444;font-size:14px;line-height:1.6;">Your Stripe payout account has been flagged and payouts are currently paused. This may be due to missing information or a document that needs to be re-submitted.</p>
                  <p style="color:#444;font-size:14px;line-height:1.6;">Please visit your dashboard and click <strong>Resolve Issue</strong> to access your Stripe Express dashboard and fix the problem.</p>
                  <a href="https://staffva.com/candidate/dashboard" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Go to Dashboard</a>
                  <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
                </div>`,
              });
          } catch { /* silent */ }
        }
      }
      break;
    }

    // Note: payout_completed_at on payment_periods/milestones is populated when
    // the connected account's payout reaches their bank. That event fires as
    // "payout.paid" on the connected account — wire it via a separate Connect
    // webhook listener if same-day confirmation is needed. The payout_fired_at
    // field (written by stripe.transfers.create in the escrow release handler)
    // already confirms funds were dispatched from the platform.
  }

  // Mark as successfully processed
  if (logId) {
    await supabase
      .from("webhook_log")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("id", logId);
  }

  return NextResponse.json({ received: true });

  } catch (processingError) {
    // Log the processing failure
    const errorMessage = processingError instanceof Error ? processingError.message : "Unknown processing error";
    console.error(`[StaffVA] Webhook processing failed for ${event.type}:`, errorMessage);

    if (logId) {
      await supabase
        .from("webhook_log")
        .update({
          error: errorMessage,
          processed: false,
        })
        .eq("id", logId);
    }

    // Still return 200 to prevent Stripe from retrying (we handle retries ourselves)
    return NextResponse.json({ received: true, processing_error: errorMessage });
  }
}
