import { createClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe";
import vercelConfig from "../../vercel.json";

/**
 * Is the paid-assessment system actually able to run?
 *
 * It is fully built and, at the time this was written, could not run at all:
 * without CRON_SECRET no refund ever pays out, without local payment methods
 * enabled in Stripe the Filipino VAs it is aimed at cannot pay, and without a
 * DNS record the assessment host does not resolve. None of those are code
 * problems and none of them announce themselves — the app simply behaves as
 * though nobody wants to buy anything.
 *
 * So this exists to replace "someone remembers to check" with a page that
 * says which specific thing is missing.
 *
 * TWO RULES, both non-negotiable:
 *
 *  1. NEVER report a secret's VALUE. Only whether it is set, and what breaks
 *     if it is not. Everything here is designed to be safe to screenshot.
 *  2. Say what BREAKS, not that something is "misconfigured". A check that
 *     reports "CRON_SECRET missing" is a puzzle; one that reports "refunds we
 *     owe candidates will never be paid" is an instruction.
 */

export type CheckStatus = "ok" | "blocked" | "degraded" | "unknown";

export interface Check {
  id: string;
  /** What this guards, in the reader's terms. */
  label: string;
  status: CheckStatus;
  /** What is actually broken right now. Empty when ok. */
  impact: string;
  /** What to do about it. Empty when ok. */
  fix: string;
}

export interface ReadinessReport {
  /** Nothing is blocked AND nothing failed to run. */
  ready: boolean;
  blocked: number;
  degraded: number;
  /** Checks that could not reach their dependency to answer at all. */
  unknown: number;
  checks: Check[];
  checkedAt: string;
}

const set = (name: string): boolean => {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
};

function envCheck(
  id: string,
  label: string,
  vars: string[],
  impact: string,
  fix: string,
  severity: "blocked" | "degraded" = "blocked"
): Check {
  const missing = vars.filter((v) => !set(v));
  if (missing.length === 0) return { id, label, status: "ok", impact: "", fix: "" };
  return {
    id,
    label,
    status: severity,
    impact,
    // Names only. This string is meant to be safe to paste into a chat.
    fix: `${fix} (not set: ${missing.join(", ")})`,
  };
}

/**
 * Runs every check. Deliberately tolerant: one failing probe must not take
 * the whole report down, because the report is what you read WHEN things are
 * broken.
 */
export async function runReadinessChecks(): Promise<ReadinessReport> {
  const checks: Check[] = [];

  // ── Money in ──
  checks.push(
    envCheck(
      "stripe-keys",
      "Taking payment for an assessment",
      // Secret key only. The assessment is a HOSTED Stripe Checkout Session
      // built server-side, so the publishable key plays no part in it — that
      // one is used by the client-side escrow funding components, which is a
      // different surface and gets its own check below.
      ["STRIPE_SECRET_KEY"],
      "Nobody can buy a sitting. Checkout returns an error before any charge is attempted.",
      "Set STRIPE_SECRET_KEY in the deployment environment."
    )
  );

  checks.push(
    envCheck(
      "stripe-webhook",
      "Crediting a payment once it lands",
      ["STRIPE_WEBHOOK_SECRET"],
      "Candidates are charged and receive NOTHING. The webhook is the only thing that marks a purchase paid, and an unverifiable event is rejected — so the money leaves their account and no sitting appears.",
      "Set the signing secret from the Stripe webhook endpoint."
    )
  );

  checks.push(
    envCheck(
      "stripe-publishable",
      "Clients funding escrow in the browser",
      ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"],
      "Unrelated to the assessment, which uses hosted Checkout. This is the key the client-side escrow and verify-to-fund components load Stripe.js with; without it those surfaces fail.",
      "Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY and redeploy (NEXT_PUBLIC_ vars are baked into the build).",
      "degraded"
    )
  );

  // ── Money back ──
  checks.push(
    envCheck(
      "cron-secret",
      "Paying refunds we owe",
      ["CRON_SECRET"],
      "Every refund we owe stays owed. /api/cron/process-refunds returns 401 without this, so a candidate failed by our own audio pipeline is never repaid — the obligation is recorded and never settled.",
      "Set CRON_SECRET and confirm Vercel's cron requests carry it."
    )
  );

  // ── The assessment host ──
  //
  // Read STATICALLY, not through the `set()` helper, and the difference is the
  // whole value of this check. A dynamic process.env[name] lookup reads the
  // RUNTIME environment; a NEXT_PUBLIC_ var is inlined into the bundle at BUILD
  // time. Set the variable in Vercel without redeploying and the dynamic form
  // reports "ok" while every candidate's browser still has the old value — the
  // check would confirm exactly the state it exists to catch. Referencing it
  // literally makes this report what was actually built.
  const inlinedTestHost = process.env.NEXT_PUBLIC_ENGLISH_TEST_URL;
  checks.push(
    inlinedTestHost && inlinedTestHost.trim()
      ? { id: "english-test-host", label: "The English test's own address", status: "ok", impact: "", fix: "" }
      : {
          id: "english-test-host",
          label: "The English test's own address",
          status: "degraded",
          impact:
            "The test still works, at /assessment on the main site. englishtest.staffva.com is simply not used yet.",
          fix: "Add englishtest.staffva.com to the Vercel project with a DNS record, then set NEXT_PUBLIC_ENGLISH_TEST_URL to https://englishtest.staffva.com and REDEPLOY — this value is baked into the build, so setting it alone changes nothing.",
        }
  );

  // ── Vendors the sitting itself needs ──
  checks.push(
    envCheck(
      "assessment-vendors",
      "Grading a sitting",
      ["ANTHROPIC_API_KEY", "DEEPGRAM_API_KEY"],
      "The assessment silently shrinks and the composite renormalizes, so candidates pay full price for a smaller test. Precisely: without ANTHROPIC_API_KEY nothing open-response is dealt at all; without DEEPGRAM_API_KEY the SPOKEN parts (read-aloud, listening, speaking) drop while the written part survives, because writing is gated on the Anthropic key alone.",
      "Set the grading vendor keys."
    )
  );

  checks.push(
    envCheck(
      "email",
      "Telling candidates what happened",
      ["RESEND_API_KEY"],
      "Results and technical-issue emails are queued and never sent.",
      "Set RESEND_API_KEY.",
      "degraded"
    )
  );

  // ── Can the intended buyers actually pay? ──
  checks.push(await checkPaymentMethods());
  checks.push(checkPhilippinesRail());

  // ── Database objects the money path depends on ──
  checks.push(await checkDatabase());

  // ── Is the refund worker actually scheduled? ──
  checks.push(checkRefundCron());

  // ── Can anyone prove who they are? ──
  // Both of these are account configuration, not code: Identity has to be
  // switched on, and the webhook has to carry the identity events. Either
  // missing and the candidate-visible symptom is the same — a verification
  // that never completes — with nothing in the app able to say why.
  checks.push(await checkIdentityEnabled());
  checks.push(await checkIdentityWebhookEvents());

  const blocked = checks.filter((c) => c.status === "blocked").length;
  const degraded = checks.filter((c) => c.status === "degraded").length;
  const unknown = checks.filter((c) => c.status === "unknown").length;

  return {
    // An unanswered check is not a passed one. `ready` counted only "blocked",
    // so a probe that could not reach Stripe or the database at all — the state
    // you are most likely to be in during an incident — reported green.
    ready: blocked === 0 && unknown === 0,
    blocked,
    degraded,
    unknown,
    checks,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Card-backed rails. Every one of these ultimately charges a card, so none of
 * them helps a candidate who does not have one.
 *
 * This list is why the check exists in this form. Apple Pay and Google Pay are
 * switched ON BY DEFAULT on a stock Stripe account and each carries a
 * display_preference, so an earlier version of this check — which subtracted
 * only `card` and `link` — reported "ok" on precisely the card-only account it
 * was written to catch, and the CI gate inherited that.
 */
const CARD_BACKED = new Set([
  "card",
  "link",
  "apple_pay",
  "google_pay",
  "samsung_pay",
  "amazon_pay",
  "revolut_pay",
  "cartes_bancaires",
  "jcb",
  "kr_card",
  "kakao_pay",
  "naver_pay",
  "payco",
]);


/**
 * Is Stripe Identity switched on for this account?
 *
 * It is not on by default: it needs activating in the dashboard, and until it
 * is, identity.verificationSessions.create throws. That surfaces to the
 * candidate as "Stripe Identity error: ..." from /api/identity/create-session
 * and nothing else — no session row, no retry path, no signal anywhere that
 * the ACCOUNT is the problem rather than their document.
 *
 * Probed with a LIST, deliberately. Creating a session to find out would mint
 * a real verification session on a live account every time this report is
 * read; list is read-only, free, and fails the same way when Identity is off.
 */
async function checkIdentityEnabled(): Promise<Check> {
  const id = "identity-enabled";
  const label = "Verifying a candidate's ID at all";

  if (!set("STRIPE_SECRET_KEY")) {
    return {
      id,
      label,
      status: "unknown",
      impact: "No Stripe key, so this could not be asked.",
      fix: "Set STRIPE_SECRET_KEY.",
    };
  }

  try {
    await getStripe().identity.verificationSessions.list({ limit: 1 });
    return { id, label, status: "ok", impact: "", fix: "" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id,
      label,
      status: "blocked",
      impact:
        "Nobody can verify their ID. /api/identity/create-session throws, and the candidate is shown a raw Stripe error with no way forward — while the profile stays unverified.",
      fix: `Activate Stripe Identity in the dashboard (Products > Identity), then re-run this. Stripe said: ${message.slice(0, 160)}`,
    };
  }
}

/**
 * Does a webhook endpoint actually subscribe to the identity events?
 *
 * A verification is finished by Stripe, not by us: the candidate is redirected
 * back before Stripe has decided, so identity.verification_session.verified is
 * the ONLY thing that moves them to passed. An endpoint that does not list
 * that event leaves every candidate who completes the flow sitting at
 * "pending" for ever, with the money and the document already spent.
 */
async function checkIdentityWebhookEvents(): Promise<Check> {
  const id = "identity-webhook-events";
  const label = "Hearing back that an ID passed";
  const NEEDED = [
    "identity.verification_session.verified",
    "identity.verification_session.requires_input",
  ];

  if (!set("STRIPE_SECRET_KEY")) {
    return { id, label, status: "unknown", impact: "No Stripe key, so this could not be asked.", fix: "Set STRIPE_SECRET_KEY." };
  }

  try {
    const endpoints = await getStripe().webhookEndpoints.list({ limit: 20 });
    const live = endpoints.data.filter((e) => e.status !== "disabled");
    if (live.length === 0) {
      return {
        id,
        label,
        status: "blocked",
        impact: "No enabled webhook endpoint exists, so no verification can ever complete.",
        fix: "Add a webhook endpoint pointing at /api/stripe/webhook and subscribe the identity events.",
      };
    }
    // "*" is Stripe's all-events wildcard and counts as subscribed.
    const covered = (event: string) =>
      live.some((e) => e.enabled_events.includes(event) || e.enabled_events.includes("*"));
    const missing = NEEDED.filter((e) => !covered(e));
    if (missing.length === 0) return { id, label, status: "ok", impact: "", fix: "" };

    return {
      id,
      label,
      status: "blocked",
      impact:
        "A candidate completes verification and stays 'pending' for ever. The redirect back happens BEFORE Stripe decides, so the webhook is the only thing that records the result.",
      fix: `Subscribe these events on the webhook endpoint: ${missing.join(", ")}.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id,
      label,
      status: "unknown",
      impact: `Could not read the webhook endpoints (${message.slice(0, 120)}).`,
      fix: "Confirm the Stripe key is valid and has permission to read webhook endpoints.",
    };
  }
}

/** Read the methods this account can actually offer at checkout. */
async function enabledPaymentMethods(): Promise<string[]> {
  const configs = await getStripe().paymentMethodConfigurations.list({ limit: 10 });
  const enabled = new Set<string>();
  for (const cfg of configs.data.filter((c) => c.active !== false)) {
    for (const [method, value] of Object.entries(cfg as unknown as Record<string, unknown>)) {
      const entry = value as { display_preference?: { value?: string }; available?: boolean } | null;
      if (!entry || typeof entry !== "object" || !entry.display_preference) continue;
      // `available` is the authoritative field: Stripe documents it as true
      // only when display_preference is on AND the underlying capability is
      // active. Toggling a method on in the dashboard flips display_preference
      // immediately while the capability stays in review for hours or days —
      // exactly the window right after someone acts on this report.
      if (entry.available === true) enabled.add(method);
    }
  }
  return [...enabled];
}

/**
 * Whether anything other than a card can pay.
 *
 * The checkout deliberately does NOT pin payment_method_types, so Stripe
 * serves whatever the DASHBOARD has enabled; code cannot turn a method on. A
 * card-only account therefore fails silently and asymmetrically — checkout
 * works, the page loads, and the people this product exists for simply cannot
 * complete a purchase. There is no error to find in a log.
 */
async function checkPaymentMethods(): Promise<Check> {
  const id = "payment-methods";
  const label = "A way to pay that is not a card";

  if (!set("STRIPE_SECRET_KEY")) {
    return {
      id,
      label,
      status: "unknown",
      impact: "Could not check — no Stripe key is set.",
      fix: "Set STRIPE_SECRET_KEY, then re-run this check.",
    };
  }

  try {
    const enabled = await enabledPaymentMethods();
    const nonCard = enabled.filter((m) => !CARD_BACKED.has(m));

    if (nonCard.length === 0) {
      return {
        id,
        label,
        status: "blocked",
        impact:
          "Only card rails can pay. Every method this account offers ultimately charges a card, so a candidate without one cannot buy a sitting — and checkout will look like it works and convert nobody.",
        fix: "Enable a non-card payment method for the candidate markets in the Stripe dashboard, and check it reports available (not merely switched on — capabilities can sit in review).",
      };
    }

    return { id, label, status: "ok", impact: "", fix: "" };
  } catch (err) {
    return {
      id,
      label,
      status: "unknown",
      // Deliberately not the raw provider message: this report is promised to
      // be safe to share, and a vendor error string is not ours to vouch for.
      impact: `Could not ask Stripe which payment methods are enabled (${err instanceof Error ? err.name : "error"}).`,
      fix: "Confirm the Stripe key is valid and this deployment can reach Stripe.",
    };
  }
}

/**
 * The Philippines, which is 172 of the 254 live candidates.
 *
 * This one is not a configuration probe — it is a standing fact about the
 * payment provider, surfaced here because it is the single largest commercial
 * risk in the paid-assessment model and nothing else in the system states it.
 *
 * The installed Stripe SDK (v20) defines no `gcash` and no `paymaya` anywhere,
 * and its PaymentMethodConfiguration exposes no Philippine local method at
 * all. The SEA methods it does define — grabpay, paynow, promptpay, fpx — are
 * Singapore, Thailand and Malaysia. So on this provider, a Filipino candidate
 * pays by international card or does not pay.
 *
 * That matters because most Filipino VAs do not hold one. An earlier version
 * of this file told the owner to "enable GCash and Maya in the Stripe
 * dashboard", which is not a toggle that exists — the honest finding is that
 * the rail may not exist on Stripe at all, and that is a launch decision
 * rather than a configuration step.
 */
function checkPhilippinesRail(): Check {
  return {
    id: "philippines-rail",
    label: "How Filipino candidates actually pay",
    status: "degraded",
    impact:
      "172 of the 254 live candidates are in the Philippines, and Stripe (as installed here) offers no Philippine local payment method — no GCash, no Maya, nothing PH-specific. Those candidates can only pay by international card, which most Filipino VAs do not have. Expect the assessment to convert close to zero in the largest market.",
    fix: "A decision, not a setting. Either add a second provider for PH collection, or move the cost off the candidate (the client pays, or the platform absorbs it — vendor cost per sitting is pennies against the $3-5 already spent acquiring that candidate). Verify Stripe's current country support directly before ruling the first option out.",
  };
}

/**
 * The migrations that carry the money path. A deployment can be perfectly
 * configured and still be pointed at a database where these were never
 * applied — which fails at the worst moment, mid-purchase, rather than here.
 */
async function checkDatabase(): Promise<Check> {
  const id = "database";
  const label = "The purchase and entitlement tables";

  if (!set("NEXT_PUBLIC_SUPABASE_URL") || !set("SUPABASE_SERVICE_ROLE_KEY")) {
    return {
      id,
      label,
      status: "unknown",
      impact: "Could not check — the database credentials are not set.",
      fix: "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    };
  }

  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error: tableErr } = await db
      .from("assessment_purchases")
      .select("id")
      .limit(1);

    if (tableErr) {
      // A transport failure resolves as an error object here rather than
      // throwing, so "cannot reach the database" and "the table does not
      // exist" arrive through the same branch. Telling someone to apply a
      // migration when their network is down sends them the wrong way.
      const transport = !tableErr.code || tableErr.message.includes("fetch failed");
      return {
        id,
        label,
        status: transport ? "unknown" : "blocked",
        impact: transport
          ? "Could not reach the database to check, so the state of the purchase tables is unknown."
          : "Nobody can buy a sitting and nothing can be credited: assessment_purchases is not reachable.",
        fix: transport
          ? "Confirm this deployment can reach Supabase, then re-run."
          : `Apply the assessment_purchases migration to this database. (${tableErr.code})`,
      };
    }

    // The entitlement functions. Called with a nonsense candidate so they do
    // nothing — this asks "does the function exist and can service_role run
    // it", not "does it work on real data".
    const probeId = "00000000-0000-0000-0000-000000000000";
    const { error: claimErr } = await db.rpc("claim_assessment_entitlement", {
      p_candidate_id: probeId,
      p_kind: "english",
      p_attempt_id: probeId,
    });
    const { error: settleErr } = await db.rpc("settle_assessment_entitlement", {
      p_attempt_id: probeId,
    });

    const missing = [
      claimErr ? "claim_assessment_entitlement" : null,
      settleErr ? "settle_assessment_entitlement" : null,
    ].filter(Boolean);

    if (missing.length > 0) {
      return {
        id,
        label,
        status: "blocked",
        impact:
          "A candidate could pay and then be refused at the door: the functions that attach a purchase to a sitting are missing, so no paid sitting can ever start.",
        fix: `Apply the entitlement-function migrations, then reload the PostgREST schema cache. Missing: ${missing.join(", ")}.`,
      };
    }

    return { id, label, status: "ok", impact: "", fix: "" };
  } catch (err) {
    return {
      id,
      label,
      status: "unknown",
      impact: `Could not check the database: ${err instanceof Error ? err.message : String(err)}`,
      fix: "Confirm the database is reachable from this deployment.",
    };
  }
}

/**
 * Vercel reads vercel.json at build time, so this is a static fact about the
 * deployment rather than something to probe. It is checked because a refund
 * worker that exists and is never called is indistinguishable, from the
 * outside, from one that runs and finds nothing to do.
 */
function checkRefundCron(): Check {
  const id = "refund-cron";
  const label = "The refund worker being scheduled";
  // Imported statically so the check reflects what was actually deployed.
  const scheduled = (vercelConfig.crons ?? []).some(
    (c: { path: string }) => c.path === "/api/cron/process-refunds"
  );

  if (!scheduled) {
    return {
      id,
      label,
      status: "blocked",
      impact:
        "Refunds we owe are recorded and never paid — nothing calls the worker that settles them with Stripe.",
      fix: "Add /api/cron/process-refunds to the crons array in vercel.json.",
    };
  }
  return { id, label, status: "ok", impact: "", fix: "" };
}
