import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function verifyAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.user_metadata?.role === "admin" ? user : null;
}

// POST — approve, reject, or flag a candidate
export async function POST(request: Request) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { candidateId, action, speakingLevel } = await request.json();

  if (!candidateId || !action) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const supabase = getAdminClient();

  if (action === "approve") {
    if (!speakingLevel) {
      return NextResponse.json(
        { error: "Speaking level required for approval" },
        { status: 400 }
      );
    }

    await supabase
      .from("candidates")
      .update({
        admin_status: "approved",
        speaking_level: speakingLevel,
      })
      .eq("id", candidateId);

    // TODO: Send approval email via Resend

    return NextResponse.json({ success: true, action: "approved" });
  }

  if (action === "reject") {
    await supabase
      .from("candidates")
      .update({ admin_status: "rejected" })
      .eq("id", candidateId);

    // TODO: Send rejection email via Resend

    return NextResponse.json({ success: true, action: "rejected" });
  }

  if (action === "flag") {
    // Keep in queue — no status change, just a flag for second review
    return NextResponse.json({ success: true, action: "flagged" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
