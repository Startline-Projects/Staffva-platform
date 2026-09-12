import { NextResponse } from "next/server";
import { recordIdentityFailure } from "@/lib/identityFailure";
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

export async function POST(request: Request) {
  let candidateId: string | undefined;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Middleware exempts /api from MFA enforcement, so an aal1 session that
    // still owes its TOTP reaches here. A half-signed-in attacker completing
    // the victim's ID check with their OWN face would poison the identity
    // record — the one column everything else trusts.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!aal || aal.currentLevel !== aal.nextLevel) { // fail CLOSED: an unreadable AAL is not a satisfied one
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Hoisted so the catch can name WHO failed. Without it a recorded
    // failure says only that create-session threw.
    ({ candidateId } = await request.json());
    if (!candidateId) {
      return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });
    }

    const admin = getAdminClient();

    const { data: candidate } = await admin
      .from("candidates")
      .select("id, full_name, id_verification_status, id_verification_reviewed_by")
      .eq("id", candidateId)
      .eq("user_id", user.id)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    if (candidate.id_verification_status === "passed") {
      return NextResponse.json({ alreadyVerified: true });
    }

    // A verdict a HUMAN wrote is not restartable from a candidate button.
    // Without this, a candidate admin-failed for a fraudulent document could
    // reset themselves to 'pending' — dropping out of the review pipeline,
    // voiding the verdict — and iterate documents until Stripe accepts one.
    // Stripe-failed candidates (no reviewed_by) retry freely; that's the
    // blurry-photo case retries exist for.
    if (candidate.id_verification_reviewed_by) {
      return NextResponse.json(
        {
          error:
            "Your verification was reviewed by our team and can't be restarted from here. Contact support@staffva.com and we'll sort it out.",
        },
        { status: 409 }
      );
    }
    if (candidate.id_verification_status === "manual_review") {
      return NextResponse.json(
        { error: "Your verification is being reviewed — no need to resubmit. Your dashboard shows the result as soon as it's in." },
        { status: 409 }
      );
    }

    // Sessions are cheap to mint but each is a fresh set of document
    // attempts — cap the iteration rate per account.
    const limited = await enforceRateLimit(`identity-session:user:${user.id}`, LIMITS.identitySession);
    if (limited) return limited;

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://staffva.com";

    // Create Stripe Identity verification session
    const session = await getStripe().identity.verificationSessions.create({
      type: "document",
      metadata: {
        candidate_id: candidateId,
        supabase_user_id: user.id,
      },
      options: {
        document: {
          require_matching_selfie: true,
        },
      },
      return_url: `${siteUrl}/verify-id?id_check=returning`,
    });

    // Update candidate status to pending and store the session id. The id is
    // the retrieval key for everything Stripe holds about this verification —
    // including the selfie the proctor will one day match against. It used to
    // be returned to the browser and discarded, which is why 105 "verified"
    // candidates had no retrievable session at all.
    await admin
      .from("candidates")
      .update({
        id_verification_status: "pending",
        id_verification_submitted_at: new Date().toISOString(),
        identity_session_id: session.id,
      })
      .eq("id", candidateId);

    return NextResponse.json({
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    // The overwhelmingly likely cause is that Stripe Identity is not
    // activated on the account — which is ours to fix, not the candidate's,
    // and affects every one of them. Record it as fatal so it shows up as a
    // vendor outage rather than 152 people quietly failing to verify.
    await recordIdentityFailure("create-session", error, candidateId);
    // And do not hand them the raw SDK string. "Stripe Identity error: ..."
    // told a candidate nothing they could act on, while sounding like their
    // document was the problem.
    return NextResponse.json(
      {
        error:
          "We couldn't start ID verification just now. This is on our side — please try again shortly.",
      },
      { status: 503 }
    );
  }
}
