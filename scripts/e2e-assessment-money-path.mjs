/**
 * End-to-end test of the assessment money path, against real routes.
 *
 *   BASE_URL=http://localhost:3000 \
 *   node --env-file=.env.test scripts/e2e-assessment-money-path.mjs
 *
 * WHY THIS EXISTS: everything in this feature has been checked by reading it
 * and by probing the database functions directly. Neither of those exercises
 * the ROUTES. The webhook that credits a payment and the cron that pays a
 * refund have never once run against a real HTTP request — and those two are
 * the entire difference between "a candidate paid and got a sitting" and "a
 * candidate paid and got nothing".
 *
 * SAFETY. This creates real Stripe objects and real database rows, so:
 *   * it REFUSES to run against a live Stripe key (sk_live_), full stop;
 *   * it works on a candidate you name explicitly, never a random real one;
 *   * it deletes the rows it created, and reports anything it could not.
 * Run it against Stripe test mode and, ideally, a non-production database.
 *
 * WHAT IT DOES NOT COVER, stated plainly rather than implied by silence:
 * the checkout route itself. That needs a signed-in session at aal2, which a
 * script cannot hold — so the leg from "candidate clicks Buy" to "a pending
 * row exists" is still only verified by hand. Everything after it is here.
 */
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { randomUUID } from "crypto";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const CANDIDATE_EMAIL = process.env.E2E_CANDIDATE_EMAIL;

const need = (n) => {
  const v = process.env[n];
  if (!v || !v.trim()) {
    console.error(`\nMissing ${n}. This test needs it to talk to a real route.\n`);
    process.exit(2);
  }
  return v;
};

const STRIPE_KEY = need("STRIPE_SECRET_KEY");
const WEBHOOK_SECRET = need("STRIPE_WEBHOOK_SECRET");
const CRON_SECRET = need("CRON_SECRET");
const SUPABASE_URL = need("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = need("SUPABASE_SERVICE_ROLE_KEY");

// The one guard that matters. A live key here would charge and refund a real
// card, and would do it silently because every step below "succeeds".
if (STRIPE_KEY.startsWith("sk_live_")) {
  console.error(
    "\nREFUSING TO RUN: STRIPE_SECRET_KEY is a LIVE key.\n" +
      "This test creates real charges and refunds. Point it at test mode (sk_test_).\n"
  );
  process.exit(2);
}
if (!CANDIDATE_EMAIL) {
  console.error(
    "\nSet E2E_CANDIDATE_EMAIL to the candidate this test should operate on.\n" +
      "It is required on purpose — this writes purchase rows, and picking a\n" +
      "candidate for you would eventually pick a real one.\n"
  );
  process.exit(2);
}

const stripe = new Stripe(STRIPE_KEY);
const db = createClient(SUPABASE_URL, SERVICE_KEY);

let passed = 0;
let failed = 0;
const cleanup = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
  return ok;
}

/** POST a genuinely-signed Stripe event at the real webhook route. */
async function postWebhook(type, object, eventId = `evt_e2e_${randomUUID()}`) {
  // The event id is a PARAMETER because Stripe redelivers with the SAME id,
  // and that id is the only thing the route dedupes on (the unique index on
  // webhook_log (provider, event_id)). Minting a fresh one per call — which
  // this did — meant the "replay" below was a different event entirely, the
  // duplicate branch never ran, and both assertions passed for reasons that
  // had nothing to do with idempotency.
  const payload = JSON.stringify({
    id: eventId,
    object: "event",
    type,
    data: { object },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  const res = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": signature },
    body: payload,
  });
  return { status: res.status, body: await res.text(), eventId };
}

console.log(`\nASSESSMENT MONEY PATH — end to end against ${BASE_URL}\n`);

// ── Who are we testing with? ──
const { data: candidate, error: candErr } = await db
  .from("candidates")
  .select("id, email")
  .eq("email", CANDIDATE_EMAIL)
  .maybeSingle();

if (candErr || !candidate) {
  console.error(`\nNo candidate with email ${CANDIDATE_EMAIL}. ${candErr?.message ?? ""}\n`);
  process.exit(2);
}
console.log(`candidate: ${candidate.email}\n`);

// Clear any live purchase so the one-live-entitlement index does not reject
// the row we are about to create. Recorded, so a real purchase is never
// destroyed silently.
const { data: preexisting } = await db
  .from("assessment_purchases")
  .select("id, status")
  .eq("candidate_id", candidate.id)
  .eq("kind", "english")
  .is("consumed_at", null)
  .is("refunded_at", null);
if (preexisting?.length) {
  // Refuse to delete anything PAID. A paid, unspent row is a sitting somebody
  // bought; destroying it to make room for a test is not a trade this script
  // gets to make on its own. Pending rows are abandoned checkouts and safe.
  const paid = preexisting.filter((p) => p.status === "paid");
  if (paid.length) {
    console.error(
      `\nREFUSING TO RUN: ${CANDIDATE_EMAIL} holds ${paid.length} PAID, unspent ` +
        `assessment purchase(s).\nThis test would have to delete them, and a paid row is a ` +
        `sitting someone bought.\nUse a candidate with no live purchase, or settle/refund ` +
        `theirs first.\n`
    );
    process.exit(2);
  }
  console.log(`  note  clearing ${preexisting.length} abandoned pending row(s)`);
  await db.from("assessment_purchases").delete().in("id", preexisting.map((p) => p.id));
}

// ── 1. A payment arrives ──
console.log("1. crediting a payment");
const sessionId = `cs_test_e2e_${randomUUID().replace(/-/g, "")}`;
const paymentIntentId = `pi_test_e2e_${randomUUID().replace(/-/g, "")}`;

const { data: pending, error: pendErr } = await db
  .from("assessment_purchases")
  .insert({
    candidate_id: candidate.id,
    kind: "english",
    amount_cents: 500,
    currency: "usd",
    stripe_checkout_session_id: sessionId,
    status: "pending",
  })
  .select("id")
  .single();
check("a pending purchase row can be created", !pendErr, pendErr?.message);
if (pending) cleanup.push(pending.id);

const creditEventId = `evt_e2e_${randomUUID()}`;
const credited = await postWebhook("checkout.session.completed", {
  id: sessionId,
  object: "checkout_session",
  payment_status: "paid",
  payment_intent: paymentIntentId,
  metadata: { purpose: "assessment", candidate_id: candidate.id, kind: "english" },
}, creditEventId);
check("the webhook route accepts a signed event", credited.status === 200, `status ${credited.status}: ${credited.body}`);

const { data: afterCredit } = await db
  .from("assessment_purchases")
  .select("status, stripe_payment_intent_id")
  .eq("id", pending?.id)
  .maybeSingle();
check("the purchase is now paid", afterCredit?.status === "paid", `status=${afterCredit?.status}`);
check("the payment intent was recorded", afterCredit?.stripe_payment_intent_id === paymentIntentId);

// ── 2. Redelivery must not double-credit ──
console.log("\n2. redelivery is idempotent");
// Same event id as the credit above — that is what makes this a redelivery.
const replay = await postWebhook("checkout.session.completed", {
  id: sessionId,
  object: "checkout_session",
  payment_status: "paid",
  payment_intent: paymentIntentId,
  metadata: { purpose: "assessment", candidate_id: candidate.id, kind: "english" },
}, creditEventId);
check("a replayed event is acked", replay.status === 200);
// The route reports duplicate:true only when the unique index rejected the
// log insert, so this asserts the dedupe branch ACTUALLY RAN rather than
// asserting that some 200 came back.
let replayedAsDuplicate = false;
try { replayedAsDuplicate = JSON.parse(replay.body).duplicate === true; } catch { /* not json */ }
check("the replay took the duplicate branch, not the handler", replayedAsDuplicate, replay.body);
const { count: rowCount } = await db
  .from("assessment_purchases")
  .select("*", { count: "exact", head: true })
  .eq("stripe_checkout_session_id", sessionId);
check("no duplicate purchase row was created", rowCount === 1, `found ${rowCount}`);

// ── 3. The sitting ──
console.log("\n3. claiming and settling a sitting");
const attemptId = randomUUID();
const { data: claimed } = await db.rpc("claim_assessment_entitlement", {
  p_candidate_id: candidate.id, p_kind: "english", p_attempt_id: attemptId,
});
check("the sitting can be claimed", claimed === pending?.id);

const { data: midSitting } = await db
  .from("assessment_purchases")
  .select("id")
  .eq("candidate_id", candidate.id).eq("kind", "english").eq("status", "paid")
  .is("consumed_at", null).is("refunded_at", null)
  .maybeSingle();
check("mid-sitting the candidate still reads as PAID (no paywall, no second charge)", midSitting?.id === pending?.id);

const { data: secondClaim } = await db.rpc("claim_assessment_entitlement", {
  p_candidate_id: candidate.id, p_kind: "english", p_attempt_id: randomUUID(),
});
check("a second, different sitting cannot claim the same purchase", secondClaim === null);

// ── 4. The refund we owe ──
console.log("\n4. refunding a sitting we broke");
await db.rpc("settle_assessment_entitlement", { p_attempt_id: attemptId });
await db.from("assessment_purchases").update({ refund_reason: "platform_failure" }).eq("id", pending?.id);

const refundRun = await fetch(`${BASE_URL}/api/cron/process-refunds`, {
  headers: { authorization: `Bearer ${CRON_SECRET}` },
});
const refundBody = await refundRun.json().catch(() => ({}));
check(
  "the refund worker authenticates and runs",
  refundRun.status === 200 || refundRun.status === 503,
  `status ${refundRun.status}: ${JSON.stringify(refundBody)}`
);

const { data: afterRefund } = await db
  .from("assessment_purchases")
  .select("status, refunded_at")
  .eq("id", pending?.id)
  .maybeSingle();
// The synthetic payment intent does not exist in Stripe, so the refund call
// fails and the row is reported rather than silently dropped. That IS the
// behaviour under test: an unrefundable debt must stay visible.
const reported = (refundBody.failures ?? []).includes(pending?.id);
check(
  "an unrefundable debt is reported, not swallowed",
  reported || afterRefund?.status === "refunded",
  `status=${afterRefund?.status}, failures=${JSON.stringify(refundBody.failures)}`
);

// Scoped to THIS purchase. Matching only on operation would pass on any row
// left by any previous run, which is an assertion that cannot fail.
const { data: vf } = await db
  .from("vendor_failures")
  .select("id, context")
  .eq("operation", "assessment_refund")
  .contains("context", { purchase_id: pending?.id });
check("this run's failure reached vendor_failures, where alerting reads it", (vf?.length ?? 0) > 0);

// ── 5. Cleanup ──
console.log("\n5. cleanup");
for (const id of cleanup) {
  const { error } = await db.from("assessment_purchases").delete().eq("id", id);
  check(`removed test purchase ${id.slice(0, 8)}`, !error, error?.message);
}

console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
