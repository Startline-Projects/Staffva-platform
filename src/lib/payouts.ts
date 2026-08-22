import { stripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";

/**
 * Initiate payout to candidate via Stripe Connect transfer.
 *
 * - If the candidate has no Stripe account or has not completed onboarding,
 *   marks the record as payout_failed and sends a Resend email to the candidate.
 *   Does not block the caller.
 * - If onboarding is complete, creates a Stripe Transfer to the candidate's
 *   Express account. Stripe deducts transfer fees from the connected account —
 *   we pass the full payout amount without adjustment.
 * - On success: writes stripe_transfer_id and payout_fired_at back to the record.
 * - On failure: writes payout_failed = true and payout_failure_reason for manual review.
 *
 * Shared by the client-triggered release (api/escrow/release) and the scheduled
 * auto-release (api/escrow/auto-release) so both paths move money identically.
 * The Stripe idempotencyKey is keyed on the record being paid, so the two paths
 * can never pay the same period/milestone twice even if they race.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function initiatePayout(
  admin: any,
  candidateId: string,
  amountUsd: number,
  recordType: "period" | "milestone",
  recordId: string
) {
  const table = recordType === "period" ? "payment_periods" : "milestones";

  const { data: candidate } = await admin
    .from("candidates")
    .select("stripe_account_id, stripe_onboarding_complete, full_name, email")
    .eq("id", candidateId)
    .single();

  if (!candidate) return;

  // Guard: Stripe account not set up or onboarding incomplete
  if (!candidate.stripe_account_id || !candidate.stripe_onboarding_complete) {
    await admin
      .from(table)
      .update({
        payout_failed: true,
        payout_failure_reason: "Stripe account not set up or onboarding incomplete",
      })
      .eq("id", recordId);

    // Notify candidate to set up their payout account
    if (process.env.RESEND_API_KEY && candidate.email) {
      try {
        await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: candidate.email,
            subject: "Action required — set up your payout account to receive your payment",
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Set Up Your Payout Account</h2>
              <p style="color:#444;font-size:14px;">Hi ${candidate.full_name},</p>
              <p style="color:#444;font-size:14px;line-height:1.6;">A payment of <strong>$${amountUsd.toFixed(2)}</strong> has been released for you, but we were unable to process it because your Stripe payout account is not yet set up.</p>
              <p style="color:#444;font-size:14px;line-height:1.6;">Please complete your payout account setup from your dashboard. Once active, our team will manually process this payment.</p>
              <a href="https://staffva.com/candidate/dashboard" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Set Up Payouts Now</a>
              <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
            </div>`,
          });
      } catch { /* silent */ }
    }

    // Flag for admin visibility
    console.error(
      `[StaffVA Payout Alert] Payout failed — candidate ${candidateId} has no Stripe account. Record: ${table}/${recordId} — $${amountUsd}`
    );
    return;
  }

  // Attempt Stripe Connect transfer
  try {
    const transfer = await stripe.transfers.create(
      {
        amount: Math.round(amountUsd * 100), // convert to cents
        currency: "usd",
        destination: candidate.stripe_account_id,
        transfer_group: recordId,
      },
      {
        // Belt-and-braces against a duplicate payout: keyed on the record being
        // paid, so a retry — or the manual and automatic release paths racing —
        // returns the original transfer instead of moving money a second time.
        // (transfer_group does NOT deduplicate.)
        idempotencyKey: `payout-${recordType}-${recordId}`,
      }
    );

    await admin
      .from(table)
      .update({
        stripe_transfer_id: transfer.id,
        payout_fired_at: new Date().toISOString(),
      })
      .eq("id", recordId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Stripe error";

    await admin
      .from(table)
      .update({
        payout_failed: true,
        payout_failure_reason: message,
      })
      .eq("id", recordId);

    // Flag for manual review — do not retry automatically
    console.error(
      `[StaffVA Payout Alert] Stripe transfer failed — candidate ${candidateId}, record ${table}/${recordId}: ${message}`
    );
  }
}
