import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { candidateId } = await request.json();
    if (!candidateId) {
      return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });
    }

    const admin = getAdminClient();

    // Verify this candidate belongs to the user
    const { data: candidate } = await admin
      .from("candidates")
      .select("id, full_name, id_verification_status")
      .eq("id", candidateId)
      .eq("user_id", user.id)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    // Already verified
    if (candidate.id_verification_status === "passed") {
      return NextResponse.json({ alreadyVerified: true });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    // Create Stripe Identity verification session
    const session = await stripe.identity.verificationSessions.create({
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
      return_url: `${appUrl}/apply?step=id_verification_complete`,
    });

    // Update candidate status to pending
    await admin
      .from("candidates")
      .update({ id_verification_status: "pending" })
      .eq("id", candidateId);

    return NextResponse.json({
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("Stripe Identity error:", error);
    return NextResponse.json(
      { error: "Failed to create verification session" },
      { status: 500 }
    );
  }
}
