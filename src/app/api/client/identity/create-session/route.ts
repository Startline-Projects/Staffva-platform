import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Start Stripe Identity for a CLIENT — the candidate route's twin
 * (api/identity/create-session), keyed to the clients table.
 *
 * The guards are the same ones that route learned, and they are not
 * boilerplate:
 *  • aal1 sessions are refused. Middleware exempts /api from MFA
 *    enforcement, so a half-signed-in attacker could otherwise complete the
 *    victim's ID check with their OWN face and poison the record every money
 *    decision then trusts.
 *  • a status a HUMAN wrote (id_verification_reviewed_by) is not restartable
 *    from a button, or a client failed for a fraudulent document could reset
 *    themselves and iterate documents until Stripe accepts one.
 *  • sessions are rate-limited per account: each one is a fresh set of
 *    document attempts.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    if (user.app_metadata?.role !== "client") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    // Fail CLOSED: an unreadable AAL is not a satisfied one.
    if (!aal || aal.currentLevel !== aal.nextLevel) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = getAdminClient();
    const { data: client } = await admin
      .from("clients")
      .select("id, full_name, id_verification_status, id_verification_reviewed_by")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    if (client.id_verification_status === "passed") {
      return NextResponse.json({ alreadyVerified: true });
    }
    if (client.id_verification_reviewed_by) {
      return NextResponse.json(
        {
          error:
            "Your verification was reviewed by our team and can't be restarted from here. Contact support@staffva.com and we'll sort it out.",
        },
        { status: 409 }
      );
    }
    if (client.id_verification_status === "manual_review") {
      return NextResponse.json(
        { error: "Your verification is being reviewed — no need to resubmit. This page shows the result as soon as it's in." },
        { status: 409 }
      );
    }

    const limited = await enforceRateLimit(`identity-session:user:${user.id}`, LIMITS.identitySession);
    if (limited) return limited;

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://staffva.com";

    const session = await getStripe().identity.verificationSessions.create({
      type: "document",
      metadata: {
        // The webhook branches on which of these is present.
        client_id: client.id,
        supabase_user_id: user.id,
      },
      options: { document: { require_matching_selfie: true } },
      return_url: `${siteUrl}/verify?id_check=returning`,
    });

    await admin
      .from("clients")
      .update({
        id_verification_status: "pending",
        id_verification_submitted_at: new Date().toISOString(),
        identity_session_id: session.id,
      })
      .eq("id", client.id);

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[client identity] session create failed:", msg);
    return NextResponse.json({ error: `Stripe Identity error: ${msg}` }, { status: 500 });
  }
}
