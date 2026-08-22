import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

    const supabase = getAdminClient();

    // Check current status in DB
    const { data: candidate } = await supabase
      .from("candidates")
      .select("id_verification_status")
      .eq("id", candidateId)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    // If already passed or failed, return that
    if (candidate.id_verification_status === "passed" || candidate.id_verification_status === "failed") {
      return NextResponse.json({ status: candidate.id_verification_status });
    }

    // Try to check with Stripe directly if available
    try {
      const { stripe } = await import("@/lib/stripe");

      // List recent verification sessions for this candidate
      const sessions = await stripe.identity.verificationSessions.list({
        limit: 5,
      });

      for (const session of sessions.data) {
        const metadata = session.metadata as Record<string, string>;
        if (metadata?.candidate_id === candidateId) {
          if (session.status === "verified") {
            // Update DB
            await supabase
              .from("candidates")
              .update({ id_verification_status: "passed" })
              .eq("id", candidateId);
            return NextResponse.json({ status: "passed" });
          }
          if (session.status === "requires_input") {
            await supabase
              .from("candidates")
              .update({ id_verification_status: "failed" })
              .eq("id", candidateId);
            return NextResponse.json({ status: "failed" });
          }
          // Still processing
          return NextResponse.json({ status: "pending" });
        }
      }
    } catch {
      // Stripe check failed — return current DB status
    }

    return NextResponse.json({ status: candidate.id_verification_status });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
