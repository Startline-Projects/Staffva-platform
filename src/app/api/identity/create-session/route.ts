import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
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
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { candidateId } = await request.json();
    if (!candidateId) {
      return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });
    }

    const admin = getAdminClient();

    const { data: candidate } = await admin
      .from("candidates")
      .select("id, full_name, id_verification_status")
      .eq("id", candidateId)
      .eq("user_id", user.id)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    if (candidate.id_verification_status === "passed") {
      return NextResponse.json({ alreadyVerified: true });
    }

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
      return_url: `${siteUrl}/apply?flow=id&id_check=returning`,
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
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Stripe Identity error:", msg);
    return NextResponse.json(
      { error: `Stripe Identity error: ${msg}` },
      { status: 500 }
    );
  }
}
