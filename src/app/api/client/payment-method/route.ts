import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Putting a card on file.
 *
 * POST creates a Stripe SetupIntent and returns its client secret for the
 * Elements form. A SetupIntent is the reason "$0 charged today" is a fact
 * here rather than a promise: it authorises nothing and captures nothing —
 * it saves an instrument. There is no amount to get wrong.
 *
 * The Atlas prototype's model ("authorize at signature, capture per pay
 * period") is cut on record: card authorisations expire in about seven days,
 * so an authorisation held from signature until the first approved work is
 * not a thing that exists. StaffVA funds escrow per period instead, and the
 * copy describes that.
 *
 * WHAT THE SAVED CARD DOES TODAY, precisely: it satisfies the funding gate
 * and it is what the billing surface names. It is NOT yet the instrument
 * charged when funding runs — api/escrow/fund still collects a payment
 * method in its own sheet. Review caught the first draft of this file
 * claiming otherwise in a comment. Charging the card on file (and letting
 * people replace it) is the billing step's work; until then the copy on
 * /verify says what actually happens.
 *
 * PUT confirms: after Elements reports success the browser calls back with
 * the SetupIntent id, and the card details are read from STRIPE, never from
 * the request body — a client could otherwise claim any brand and last4 they
 * liked, and the billing surface would repeat it.
 *
 * Both halves fail closed on aal2, like the identity routes: middleware
 * exempts /api from MFA enforcement, so an aal1 session (password stolen,
 * second factor outstanding) reaches here, and payment_method_id is one of
 * exactly two columns the money gate reads.
 */
async function requireVerifiedClient() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (user.app_metadata?.role !== "client") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  // Fail CLOSED: an unreadable AAL is not a satisfied one.
  if (!aal || aal.currentLevel !== aal.nextLevel) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  return { user };
}
export async function POST() {
  const auth = await requireVerifiedClient();
  if (auth.error) return auth.error;
  const user = auth.user!;

  const limited = await enforceRateLimit(`client-setup-intent:${user.id}`, LIMITS.cardSetup);
  if (limited) return limited;

  const admin = getAdminClient();
  const { data: client } = await admin
    .from("clients")
    .select("id, email, stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  try {
    const stripe = getStripe();
    let customerId = client.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: client.email || user.email,
        metadata: { supabase_user_id: user.id, client_id: client.id },
      });
      // Only claim the row if it is still empty. Two concurrent calls (a
      // double-click, a retried request) each create a customer; without
      // this the second overwrites the first, and a SetupIntent confirmed
      // against the orphaned one would attach a card to a customer the row
      // no longer names.
      const { data: claimed } = await admin
        .from("clients")
        .update({ stripe_customer_id: customer.id })
        .eq("id", client.id)
        .is("stripe_customer_id", null)
        .select("stripe_customer_id")
        .maybeSingle();
      if (claimed?.stripe_customer_id) {
        customerId = claimed.stripe_customer_id;
      } else {
        const { data: winner } = await admin
          .from("clients")
          .select("stripe_customer_id")
          .eq("id", client.id)
          .maybeSingle();
        customerId = winner?.stripe_customer_id ?? customer.id;
      }
    }

    const intent = await stripe.setupIntents.create({
      customer: customerId,
      // Cards only, explicitly. Left to the dashboard's method set, a client
      // could save a bank debit or a wallet: payment_method_id would be set
      // (so the gate opens and the banner clears) while last4 stayed null —
      // and /verify, which reads last4, would still show step 2 unfinished.
      // Two columns disagreeing about the same fact.
      payment_method_types: ["card"],
      usage: "off_session",
      metadata: { client_id: client.id, supabase_user_id: user.id },
    });

    return NextResponse.json({ clientSecret: intent.client_secret });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[client payment-method] setup intent failed:", msg);
    return NextResponse.json({ error: "Could not start card setup." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireVerifiedClient();
  if (auth.error) return auth.error;
  const user = auth.user!;

  const body = await request.json().catch(() => ({}));
  const setupIntentId = typeof body.setupIntentId === "string" ? body.setupIntentId : "";
  if (!/^seti_[A-Za-z0-9_]+$/.test(setupIntentId)) {
    return NextResponse.json({ error: "setupIntentId required" }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data: client } = await admin
    .from("clients")
    .select("id, stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  try {
    const stripe = getStripe();
    const intent = await stripe.setupIntents.retrieve(setupIntentId);

    // The intent must be THIS client's. Without this check any client could
    // post another's SetupIntent id and attach their card to their own row.
    if (intent.metadata?.client_id !== client.id) {
      return NextResponse.json({ error: "Not your setup intent" }, { status: 403 });
    }
    if (intent.status !== "succeeded" || !intent.payment_method) {
      return NextResponse.json(
        { error: "That card setup didn't complete. Try again." },
        { status: 409 }
      );
    }

    const pmId =
      typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method.id;
    const pm = await stripe.paymentMethods.retrieve(pmId);
    const cardDetails = pm.card;

    await admin
      .from("clients")
      .update({
        payment_method_id: pmId,
        payment_method_brand: cardDetails?.brand ?? null,
        payment_method_last4: cardDetails?.last4 ?? null,
        payment_method_exp_month: cardDetails?.exp_month ?? null,
        payment_method_exp_year: cardDetails?.exp_year ?? null,
        payment_method_added_at: new Date().toISOString(),
      })
      .eq("id", client.id);

    return NextResponse.json({
      card: {
        brand: cardDetails?.brand ?? null,
        last4: cardDetails?.last4 ?? null,
        expMonth: cardDetails?.exp_month ?? null,
        expYear: cardDetails?.exp_year ?? null,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[client payment-method] confirm failed:", msg);
    return NextResponse.json({ error: "Could not save that card." }, { status: 500 });
  }
}
