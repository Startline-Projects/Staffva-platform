/**
 * Go-live readiness, from a terminal.
 *
 *   node --env-file=.env.local scripts/check-readiness.mjs
 *
 * Same questions the admin endpoint asks, runnable against whichever
 * environment file you point it at — so a deployment can be checked BEFORE it
 * is deployed, which is the only time the answer is cheap.
 *
 * Prints names and consequences, never values. Exits non-zero when anything is
 * blocked, so it can gate a release.
 *
 * This deliberately re-implements the checks rather than importing
 * src/lib/readiness.ts: that module is TypeScript with Next path aliases and a
 * JSON import, none of which plain node resolves.
 *
 * That duplication is a real hazard and has already bitten once — the
 * card-backed-wallet bug existed in BOTH copies, so the CI gate inherited it
 * and exited 0. The database probe is the same table, the same two RPCs and
 * the same probe id as the module; the wording of a few impacts differs. If
 * you change a check in one file, change it in the other.
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const on = (n) => typeof process.env[n] === "string" && process.env[n].trim() !== "";
const checks = [];
const add = (label, status, impact, fix) => checks.push({ label, status, impact, fix });

function env(label, vars, impact, fix, severity = "blocked") {
  const missing = vars.filter((v) => !on(v));
  if (missing.length === 0) return add(label, "ok", "", "");
  add(label, severity, impact, `${fix} (not set: ${missing.join(", ")})`);
}

env(
  // Secret key only — the assessment uses a HOSTED Checkout Session built
  // server-side, so the publishable key plays no part in it. That one belongs
  // to the client-side escrow components and is checked separately.
  "Taking payment for an assessment",
  ["STRIPE_SECRET_KEY"],
  "Nobody can buy a sitting.",
  "Set STRIPE_SECRET_KEY."
);
env(
  "Clients funding escrow in the browser",
  ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"],
  "Unrelated to the assessment; this is the key the client-side escrow components load Stripe.js with.",
  "Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY and redeploy.",
  "degraded"
);
env(
  "Crediting a payment once it lands",
  ["STRIPE_WEBHOOK_SECRET"],
  "Candidates are charged and receive NOTHING — the webhook is the only thing that marks a purchase paid.",
  "Set the signing secret from the Stripe webhook endpoint."
);
env(
  "Paying refunds we owe",
  ["CRON_SECRET"],
  "Every refund we owe stays owed: /api/cron/process-refunds returns 401 without this.",
  "Set CRON_SECRET."
);
env(
  "The English test's own address",
  ["NEXT_PUBLIC_ENGLISH_TEST_URL"],
  "The test still works at /assessment on the main site; englishtest.staffva.com is just unused.",
  "Add the domain + DNS in Vercel, then set NEXT_PUBLIC_ENGLISH_TEST_URL and redeploy.",
  "degraded"
);
env(
  "Grading a sitting",
  ["ANTHROPIC_API_KEY", "DEEPGRAM_API_KEY"],
  "The assessment silently shrinks and candidates pay full price for a smaller test. Without ANTHROPIC_API_KEY nothing open-response is dealt; without DEEPGRAM_API_KEY the spoken parts drop while writing survives.",
  "Set the grading vendor keys."
);
env(
  "Telling candidates what happened",
  ["RESEND_API_KEY"],
  "Results and technical-issue emails are queued and never sent.",
  "Set RESEND_API_KEY.",
  "degraded"
);

// ── Can the intended buyers actually pay? ──
// Every one of these ultimately charges a card. Apple Pay and Google Pay are ON
// BY DEFAULT on a stock Stripe account, so subtracting only "card" and "link" —
// which this did — reported ok on exactly the card-only account being hunted,
// and exited 0, green-lighting the release.
const CARD_BACKED = new Set([
  "card", "link", "apple_pay", "google_pay", "samsung_pay", "amazon_pay",
  "revolut_pay", "cartes_bancaires", "jcb", "kr_card", "kakao_pay", "naver_pay", "payco",
]);
if (!on("STRIPE_SECRET_KEY")) {
  add("A way to pay that is not a card", "unknown", "No Stripe key set.", "Set STRIPE_SECRET_KEY.");
} else {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const configs = await stripe.paymentMethodConfigurations.list({ limit: 10 });
    const enabled = new Set();
    for (const cfg of configs.data.filter((c) => c.active !== false)) {
      for (const [method, value] of Object.entries(cfg)) {
        // `available` is the authoritative field — true only when the method is
        // switched on AND its capability is active. display_preference flips
        // the moment you toggle it, while the capability can sit in review.
        if (value?.display_preference && value.available === true) enabled.add(method);
      }
    }
    const nonCard = [...enabled].filter((m) => !CARD_BACKED.has(m));
    if (nonCard.length === 0) {
      add(
        "A way to pay that is not a card",
        "blocked",
        "Only card rails can pay — every method this account offers ends at a card.",
        "Enable a non-card method for the candidate markets, and confirm it reports available, not merely switched on."
      );
    } else {
      add("A way to pay that is not a card", "ok", "", "");
    }
  } catch (err) {
    add("A way to pay that is not a card", "unknown", `Could not ask Stripe (${err.name}).`, "Confirm the Stripe key is valid.");
  }
}

// The largest market, and a standing fact rather than a probe: the installed
// Stripe SDK defines no gcash and no paymaya, and its payment method
// configuration exposes no Philippine method at all.
add(
  "How Filipino candidates actually pay",
  "degraded",
  "172 of 254 live candidates are in the Philippines, and Stripe (as installed here) offers no PH local payment method. They can pay only by international card, which most Filipino VAs do not have.",
  "A decision, not a setting: add a second provider for PH collection, or move the cost off the candidate. Verify Stripe's current country support directly before ruling the first out."
);

// ── The money path's database objects ──
if (!on("NEXT_PUBLIC_SUPABASE_URL") || !on("SUPABASE_SERVICE_ROLE_KEY")) {
  add("The purchase and entitlement tables", "unknown", "Database credentials not set.", "Set the Supabase URL and service-role key.");
} else {
  let db;
  try {
    // createClient validates the URL and THROWS synchronously on a malformed
    // one. Uncaught, that killed the process before a single line of the
    // report printed — so the run told you nothing at all about the other
    // eight checks it had already completed.
    db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  } catch (err) {
    add("The purchase and entitlement tables", "unknown", `Supabase client could not be built: ${err.message}`, "Check NEXT_PUBLIC_SUPABASE_URL is a full https:// URL.");
    db = null;
  }
  const { error: tableErr } = db
    ? await db.from("assessment_purchases").select("id").limit(1)
    : { error: null };
  if (!db) { /* already reported */ } else
  if (tableErr) {
    add("The purchase and entitlement tables", "blocked", "Nobody can buy a sitting: assessment_purchases is not reachable.", `Apply the migration. (${tableErr.message})`);
  } else {
    const probe = "00000000-0000-0000-0000-000000000000";
    const { error: claimErr } = await db.rpc("claim_assessment_entitlement", {
      p_candidate_id: probe, p_kind: "english", p_attempt_id: probe,
    });
    const { error: settleErr } = await db.rpc("settle_assessment_entitlement", { p_attempt_id: probe });
    const missing = [claimErr && "claim_assessment_entitlement", settleErr && "settle_assessment_entitlement"].filter(Boolean);
    if (missing.length) {
      add("The purchase and entitlement tables", "blocked", "A candidate could pay and then be refused at the door — no paid sitting can start.", `Apply the entitlement migrations and reload the schema cache. Missing: ${missing.join(", ")}.`);
    } else {
      add("The purchase and entitlement tables", "ok", "", "");
    }
  }
}

// ── Is the refund worker scheduled? ──
try {
  const cfg = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const scheduled = (cfg.crons ?? []).some((c) => c.path === "/api/cron/process-refunds");
  if (scheduled) add("The refund worker being scheduled", "ok", "", "");
  else add("The refund worker being scheduled", "blocked", "Refunds are recorded and never paid — nothing calls the worker.", "Add /api/cron/process-refunds to crons in vercel.json.");
} catch (err) {
  add("The refund worker being scheduled", "unknown", `Could not read vercel.json: ${err.message}`, "Check the file.");
}

// ── Report ──
const icon = { ok: "  ok    ", blocked: "  BLOCK ", degraded: "  warn  ", unknown: "  ?     " };
console.log("\nPAID ASSESSMENTS — GO-LIVE READINESS\n");
for (const c of checks) {
  console.log(`${icon[c.status]}${c.label}`);
  if (c.impact) console.log(`          ${c.impact}`);
  if (c.fix) console.log(`          FIX: ${c.fix}`);
}
const blocked = checks.filter((c) => c.status === "blocked").length;
const degraded = checks.filter((c) => c.status === "degraded").length;
const unknown = checks.filter((c) => c.status === "unknown").length;
// A check that could not RUN is not a check that passed. Counting only
// "blocked" meant an unreachable Stripe or database exited 0.
const ok = blocked === 0 && unknown === 0;
console.log(
  `\n${ok ? "READY" : `NOT READY — ${blocked} blocking, ${unknown} could not be checked`}` +
    `${degraded ? `, ${degraded} degraded` : ""}\n`
);
process.exit(ok ? 0 : 1);
