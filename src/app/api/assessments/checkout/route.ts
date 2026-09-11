import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { ownsCandidate } from "@/lib/auth";
import {
  ASSESSMENT_PRICES,
  ASSESSMENT_LABELS,
  ELIGIBILITY_COLUMNS,
  checkEligibility,
  isAssessmentKind,
} from "@/lib/assessmentPurchase";

/**
 * Sell one assessment sitting.
 *
 * This is the first thing on the platform that takes money FROM a candidate
 * rather than paying money to one, so a few things are deliberate:
 *
 *  - Eligibility is checked BEFORE the session is created. Selling a sitting
 *    to someone who is blocked, already passed, or inside a retake cooldown
 *    is a refund we would have to issue by hand.
 *  - `payment_method_types` is NOT set. Leaving it off makes Stripe serve
 *    whatever is enabled in the dashboard and eligible for the buyer, which
 *    is the whole point here: most Filipino VAs hold no international card,
 *    and pinning this to ["card"] would silently exclude them. The local
 *    methods still have to be switched on in the Stripe dashboard — this
 *    code cannot enable them.
 *  - The pending row is written BEFORE the redirect, so a payment that
 *    completes always has a row for the webhook to find.
 */
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  const { candidateId, kind } = await request.json().catch(() => ({}));

  if (!candidateId || !isAssessmentKind(kind)) {
    return NextResponse.json({ error: "Missing candidateId or kind" }, { status: 400 });
  }

  if (!(await ownsCandidate(candidateId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Same MFA rule the other candidate write routes apply — /api is exempt
  // from the middleware, so each route enforces it itself. Fail closed: an
  // AAL we cannot read is not a satisfied one.
  const authClient = await createServerClient();
  const { data: aal } = await authClient.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.currentLevel !== aal.nextLevel) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = getAdminClient();

  const { data: candidate } = await supabase
    .from("candidates")
    .select(`${ELIGIBILITY_COLUMNS}, email, full_name, stripe_customer_id`)
    .eq("id", candidateId)
    .single();

  // Grandfather clause for the interview: candidates who were mid-track when
  // the interview was split into a behavioral round and a skills round stay
  // on the skills track, so any skills history counts as being through
  // Interview 1. Mirrors handleStart in the interview app.
  let hasSkillsHistory = false;
  if (kind === "interview") {
    const { count } = await supabase
      .from("ai_interviews")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", candidateId)
      .eq("kind", "skills");
    hasSkillsHistory = (count ?? 0) > 0;
  }

  const eligible = checkEligibility(kind, candidate ? { ...candidate, hasSkillsHistory } : candidate);
  if (!eligible.ok) {
    return NextResponse.json({ error: eligible.reason }, { status: 403 });
  }

  // Is their free first sitting still unspent? Then grant it and fall into
  // the "already holding one" answer below rather than taking money for
  // something they are owed (20260911201321). Idempotent, and a no-op once
  // the free go has been used — so a genuine retake still reaches Stripe.
  // Belt and braces: the dashboard already routes a free sitting past this
  // route entirely, but any other entry point would otherwise charge $5 for
  // a sitting the candidate would have got for nothing.
  const { error: grantErr } = await supabase.rpc("grant_free_assessment_sitting", {
    p_candidate_id: candidateId,
    p_kind: kind,
  });
  if (grantErr) {
    // Do NOT fall through to checkout. If the grant could not run we do not
    // know whether this sitting is owed for free, and the failure mode of
    // guessing is taking $5 from someone entitled to pay nothing.
    return NextResponse.json(
      { error: "We couldn't check your free sitting just now. Please try again in a moment." },
      { status: 503 }
    );
  }

  // Already holding a live sitting of this kind — send them to take it
  // instead of charging again. The partial unique index would reject the
  // second row anyway; this turns a 500 into an answer.
  const { data: existing } = await supabase
    .from("assessment_purchases")
    .select("id")
    .eq("candidate_id", candidateId)
    .eq("kind", kind)
    .eq("status", "paid")
    .is("consumed_at", null)
    .is("refunded_at", null)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ alreadyPaid: true, purchaseId: existing.id });
  }

  // A payment already on its way. This is the case that matters most for the
  // people this product is for: the local methods a VA without an
  // international card actually has — a bank debit, a voucher — settle
  // asynchronously, so the row sits at 'pending' for minutes or hours between
  // the Checkout session completing and the money confirming.
  //
  // Guarding only on 'paid' meant that entire window showed the Buy button
  // again. A candidate who reasonably concluded the first attempt had failed
  // could pay twice; both debits then settle, and the second credit collides
  // with the one-live-entitlement index and is stranded at 'pending' for
  // ever. Stripe would be holding $10 for one sitting with nothing in the
  // code that ever gives the second $5 back.
  //
  // One hour, not indefinitely: a session the candidate abandoned at the
  // payment page also sits at 'pending', and that must not lock them out of
  // ever buying.
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { data: inFlight } = await supabase
    .from("assessment_purchases")
    .select("id, created_at")
    .eq("candidate_id", candidateId)
    .eq("kind", kind)
    .eq("status", "pending")
    .gte("created_at", oneHourAgo)
    .order("created_at", { ascending: false })
    .maybeSingle();

  if (inFlight) {
    return NextResponse.json({
      paymentPending: true,
      purchaseId: inFlight.id,
      error:
        "You already have a payment for this in progress. Some payment methods take a little while to confirm — check back shortly before paying again.",
    });
  }

  const stripe = getStripe();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";

  try {
    // Attach a Stripe Customer so a returning buyer keeps one identity across
    // purchases and support can find their history.
    //
    // Note what this does NOT do: nothing here calls setup_future_usage, so
    // Stripe is not storing the payment method for reuse and the candidate
    // re-enters it each time. That is deliberate for now — saving a payment
    // method is a consent decision, not a convenience default — so the
    // comment says so rather than implying a saved-card flow that does not
    // exist.
    let customerId = candidate?.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: (candidate as { email?: string })?.email || undefined,
        name: (candidate as { full_name?: string })?.full_name || undefined,
        metadata: { candidate_id: candidateId },
      });
      customerId = customer.id;
      await supabase
        .from("candidates")
        .update({ stripe_customer_id: customerId })
        .eq("id", candidateId);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: ASSESSMENT_PRICES[kind],
            product_data: {
              name: ASSESSMENT_LABELS[kind],
              description:
                kind === "interview"
                  ? "One recorded skills interview, with scored feedback and the Vetted badge if you pass."
                  : "One English assessment sitting, with per-section feedback and an English tier if you pass.",
            },
          },
          quantity: 1,
        },
      ],
      // Both ids ride on the session so the webhook never has to guess which
      // sitting was bought.
      metadata: { purpose: "assessment", candidate_id: candidateId, kind },
      success_url: `${siteUrl}/candidate/dashboard?purchased=${kind}`,
      cancel_url: `${siteUrl}/candidate/dashboard?purchase_cancelled=${kind}`,
    });

    const { error: insertError } = await supabase.from("assessment_purchases").insert({
      candidate_id: candidateId,
      kind,
      amount_cents: ASSESSMENT_PRICES[kind],
      currency: "usd",
      stripe_checkout_session_id: session.id,
      status: "pending",
    });

    if (insertError) {
      // No row means a completed payment would arrive at a webhook with
      // nothing to mark paid — the candidate would be charged and get
      // nothing. Better to fail before they ever see the payment page.
      console.error("[assessment-checkout] pending row insert failed:", insertError.message);
      return NextResponse.json(
        { error: "We couldn't start checkout. Nothing has been charged — please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[assessment-checkout] stripe error:", err);
    return NextResponse.json(
      { error: "We couldn't reach our payment provider. Nothing has been charged." },
      { status: 502 }
    );
  }
}
