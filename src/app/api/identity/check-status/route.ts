import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { ownsCandidate } from "@/lib/auth";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST — Check if candidate's ID verification has been completed
// This is a fallback when the Stripe webhook hasn't fired yet
export async function POST(request: Request) {
  try {
    const { candidateId } = await request.json();
    if (!candidateId) {
      return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });
    }

    // Previously unauthenticated: anyone could read another candidate's
    // ID-verification state and drive a service-role write of it.
    if (!(await ownsCandidate(candidateId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Same MFA rule as create-session: an aal1 session still owing its TOTP
    // must not read verification state or drive the service-role sync.
    const authClient = await createServerClient();
    const { data: aal } = await authClient.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!aal || aal.currentLevel !== aal.nextLevel) { // fail CLOSED: an unreadable AAL is not a satisfied one
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const supabase = getAdminClient();

    // Check current status in DB
    const { data: candidate } = await supabase
      .from("candidates")
      .select("id_verification_status, identity_session_id, id_verification_reviewed_by")
      .eq("id", candidateId)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    // Terminal or human-owned states short-circuit BEFORE Stripe is asked.
    // manual_review and a reviewed_by stamp are review-pipeline holds: letting
    // this route overwrite them from a Stripe session verdict would dissolve
    // the exact holds create-session refuses to restart (the duplicate-
    // document case arrives here with a Stripe-verified session — that must
    // not flip a hold to 'passed').
    if (
      candidate.id_verification_status === "passed" ||
      candidate.id_verification_status === "failed" ||
      candidate.id_verification_status === "manual_review" ||
      candidate.id_verification_reviewed_by
    ) {
      return NextResponse.json({ status: candidate.id_verification_status });
    }

    // Try to check with Stripe directly if available
    try {
      const { getStripe } = await import("@/lib/stripe");

      // Retrieve THIS candidate's stored session — create-session persists
      // its id on the row for exactly this. The old code listed the 5
      // newest sessions ACCOUNT-WIDE and matched metadata: under any
      // concurrency the candidate's session fell off the page and the
      // fallback silently no-opped for everyone.
      if (!candidate.identity_session_id) {
        return NextResponse.json({ status: candidate.id_verification_status });
      }
      const session = await getStripe().identity.verificationSessions.retrieve(
        candidate.identity_session_id
      );

      if (session.status === "verified") {
        await supabase
          .from("candidates")
          .update({ id_verification_status: "passed" })
          .eq("id", candidateId);
        return NextResponse.json({ status: "passed" });
      }
      // "requires_input" is NOT terminal by itself — every session starts
      // there and sits there while the user captures documents. It only
      // means a failed ATTEMPT when Stripe attaches last_error. Writing
      // 'failed' for a merely-unsubmitted session told candidates who
      // abandoned the capture tab that their verification failed.
      if (session.status === "requires_input" && session.last_error) {
        await supabase
          .from("candidates")
          .update({ id_verification_status: "failed" })
          .eq("id", candidateId);
        return NextResponse.json({ status: "failed" });
      }
      // Unsubmitted, processing, or canceled — nothing to conclude yet.
      return NextResponse.json({ status: "pending" });
    } catch {
      // Stripe check failed — return current DB status
    }

    return NextResponse.json({ status: candidate.id_verification_status });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
