import Stripe from "stripe";

// Constructed on first use, not at module load. Building the client at module
// scope meant every route that merely imports this file evaluates it during
// `next build` page-data collection — and the Stripe constructor throws when
// STRIPE_SECRET_KEY is absent, so a missing key failed the build (and would
// crash a cold start) rather than failing the one request that needed Stripe.
let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
    client = new Stripe(key, { typescript: true });
  }
  return client;
}
