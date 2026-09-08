import { NextResponse } from "next/server";
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
 * The client's own verification + card state, and a reconcile against Stripe
 * when the webhook has not landed yet (the return_url brings people back
 * here seconds after Stripe finishes, routinely ahead of the event).
 *
 * The candidate route's rules carry over exactly:
 *  • terminal and human-owned states short-circuit BEFORE Stripe is asked —
 *    letting a Stripe verdict overwrite a manual_review hold would dissolve
 *    the very hold create-session refuses to restart;
 *  • "requires_input" is NOT a failure by itself. Every session starts there
 *    and sits there while documents are captured; it only means a failed
 *    attempt once Stripe attaches last_error. Writing 'failed' for an
 *    abandoned capture tab told people their verification had failed when
 *    they had simply not finished it.
 */
export async function GET() {
  try {
    const authClient = await createServerClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    if (user.app_metadata?.role !== "client") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { data: aal } = await authClient.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!aal || aal.currentLevel !== aal.nextLevel) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // This GET reconciles against Stripe and can write a verdict, so it is
    // budgeted like one. The page polls every 3s while a check is pending;
    // a few open tabs must not turn into an unbounded Stripe call loop.
    const limited = await enforceRateLimit(
      `client-identity-status:${user.id}`,
      LIMITS.identityStatusPoll
    );
    if (limited) return limited;

    const admin = getAdminClient();
    const { data: client } = await admin
      .from("clients")
      .select(
        "id, id_verification_status, identity_session_id, id_verification_reviewed_by, payment_method_brand, payment_method_last4, payment_method_exp_month, payment_method_exp_year"
      )
      .eq("user_id", user.id)
      .maybeSingle();
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const card = client.payment_method_last4
      ? {
          brand: client.payment_method_brand,
          last4: client.payment_method_last4,
          expMonth: client.payment_method_exp_month,
          expYear: client.payment_method_exp_year,
        }
      : null;

    const terminal =
      client.id_verification_status === "passed" ||
      client.id_verification_status === "failed" ||
      client.id_verification_status === "manual_review" ||
      !!client.id_verification_reviewed_by;

    if (terminal || !client.identity_session_id) {
      return NextResponse.json({ status: client.id_verification_status, card });
    }

    try {
      const { getStripe } = await import("@/lib/stripe");
      const session = await getStripe().identity.verificationSessions.retrieve(
        client.identity_session_id
      );
      if (session.status === "verified") {
        await admin
          .from("clients")
          .update({
            id_verification_status: "passed",
            id_verification_verified_at: new Date().toISOString(),
          })
          .eq("id", client.id);
        return NextResponse.json({ status: "passed", card });
      }
      if (session.status === "requires_input" && session.last_error) {
        await admin
          .from("clients")
          .update({ id_verification_status: "failed" })
          .eq("id", client.id);
        return NextResponse.json({ status: "failed", card });
      }
      return NextResponse.json({ status: "pending", card });
    } catch {
      // Stripe unreachable — report what we have rather than inventing a verdict.
    }

    return NextResponse.json({ status: client.id_verification_status, card });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
