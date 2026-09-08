import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hasCronSecret } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { REFUND_REASONS } from "@/lib/assessmentPurchase";

/**
 * GET /api/cron/process-refunds
 *
 * Settles the assessment refunds we owe.
 *
 * A row with `refund_reason` set and `refunded_at` still null is a debt: some
 * code path decided the candidate should get their money back and recorded
 * that fact without calling Stripe. This is the worker that calls Stripe.
 *
 * Why the two-step exists at all, rather than refunding inline at the point
 * of failure: the place that discovers we owe a refund is usually a failing
 * request — the interview scorer noticing our audio pipeline lost the
 * candidate's answers. Adding a network call to Stripe inside a handler that
 * is already going wrong is how obligations get dropped. Recording the debt is
 * one local write that either happens or doesn't; paying it is retried here
 * until it succeeds.
 *
 * The dominant case is not an edge case. 29% of interviews hit the silence
 * problem, and every one of those is now someone who paid $5 to be failed by
 * our bug.
 */
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  if (!hasCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getAdminClient();

  // ── Step 1: find sittings we failed to deliver, and turn them into debts ──
  //
  // This exists because the English assessment had NO automatic refund path
  // at all. flag_assessment_refund is called from exactly one place — the
  // interview scorer's silent-answers branch — so an English sitting our own
  // grader could never score left the candidate holding a claimed purchase
  // and a permanent "we're still grading" screen. They paid; nothing came
  // back; nothing in the code ever noticed.
  //
  // A claimed purchase whose attempt has been stuck in grading_failed for a
  // day is not a slow grader, it is a sitting we cannot deliver.
  const stuckCutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: stuckAttempts } = await supabase
    .from("test_attempts")
    .select("id")
    .eq("status", "grading_failed")
    .lt("created_at", stuckCutoff)
    .limit(50);

  if (stuckAttempts && stuckAttempts.length > 0) {
    // Settle and mark owed in one write. flag_assessment_refund cannot be
    // used here: it only matches an already-settled purchase, and a sitting
    // that never finished is still claimed, not settled.
    const { data: marked } = await supabase
      .from("assessment_purchases")
      .update({
        consumed_at: new Date().toISOString(),
        refund_reason: REFUND_REASONS.platformFailure,
      })
      .in(
        "attempt_id",
        stuckAttempts.map((a) => a.id)
      )
      .eq("status", "paid")
      .is("consumed_at", null)
      .is("refunded_at", null)
      .select("id");

    if (marked && marked.length > 0) {
      console.log(`[process-refunds] marked ${marked.length} ungradeable English sitting(s) as owed`);
    }
  }

  // ── Step 2: pay what we owe ──
  const { data: owed, error } = await supabase
    .from("assessment_purchases")
    .select("id, candidate_id, kind, amount_cents, stripe_payment_intent_id, refund_reason")
    .eq("status", "paid")
    .not("refund_reason", "is", null)
    .is("refunded_at", null)
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }

  if (!owed || owed.length === 0) {
    return NextResponse.json({ refunded: 0, failed: 0 });
  }

  let refunded = 0;
  const failures: string[] = [];

  for (const row of owed) {
    if (!row.stripe_payment_intent_id) {
      // Paid with no PaymentIntent recorded — cannot be refunded by machine.
      // Surface it rather than leaving it to be retried for ever.
      failures.push(row.id);
      await supabase.from("vendor_failures").insert({
        app: "platform",
        vendor: "stripe",
        operation: "assessment_refund",
        fatal: true,
        message: `Refund owed on purchase ${row.id} (candidate ${row.candidate_id}, ${row.kind}) but no payment_intent is recorded — needs a manual refund.`,
        context: { purchase_id: row.id, candidate_id: row.candidate_id, reason: row.refund_reason },
      });
      continue;
    }

    try {
      await getStripe().refunds.create(
        {
          payment_intent: row.stripe_payment_intent_id,
          reason: "requested_by_customer",
          metadata: {
            purchase_id: row.id,
            candidate_id: row.candidate_id,
            staffva_reason: row.refund_reason ?? "",
          },
        },
        // Stripe de-duplicates on this key, so a run that crashes after
        // refunding but before stamping the row cannot refund twice on the
        // next pass.
        { idempotencyKey: `assessment-refund-${row.id}` }
      );

      // charge.refunded will also stamp this row when it arrives; both write
      // the same terminal state, and whichever lands first wins.
      await supabase
        .from("assessment_purchases")
        .update({ status: "refunded", refunded_at: new Date().toISOString() })
        .eq("id", row.id)
        .neq("status", "refunded");

      refunded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(row.id);
      console.error(`[process-refunds] refund failed for purchase ${row.id}:`, message);
      await supabase.from("vendor_failures").insert({
        app: "platform",
        vendor: "stripe",
        operation: "assessment_refund",
        fatal: false,
        message: `Refund failed for purchase ${row.id} (candidate ${row.candidate_id}): ${message}`,
        context: { purchase_id: row.id, candidate_id: row.candidate_id, reason: row.refund_reason },
      });
    }
  }

  // Non-2xx when anything is still owed, so a stuck refund shows up red in
  // the Vercel cron dashboard instead of scrolling past as a green run.
  const status = failures.length > 0 ? 503 : 200;
  return NextResponse.json({ refunded, failed: failures.length, failures }, { status });
}
