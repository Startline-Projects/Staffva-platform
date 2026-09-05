import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/engagements/release
 *
 * Client manually releases a candidate from an engagement.
 * Lock releases. Profile goes live on browse immediately.
 *
 * Body: { engagementId }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.app_metadata?.role !== "client") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { engagementId } = await request.json();

    if (!engagementId) {
      return NextResponse.json({ error: "engagementId required" }, { status: 400 });
    }

    const admin = getAdminClient();

    // Verify engagement belongs to this client
    const { data: engagement } = await admin
      .from("engagements")
      .select("*, clients!inner(user_id)")
      .eq("id", engagementId)
      .single();

    if (!engagement || engagement.clients.user_id !== user.id) {
      return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
    }

    if (engagement.status !== "active") {
      return NextResponse.json({ error: "Engagement is not active" }, { status: 400 });
    }

    // Where both sides SIGNED an agreement, its termination clause governs:
    // "14 days' written notice delivered through the StaffVA platform."
    // Instant release on a signed engagement is the platform contradicting
    // the document it generated — the step-18 audit's finding. Unsigned
    // engagements (the legacy four included) keep this path.
    const { data: executedContract } = await admin
      .from("engagement_contracts")
      .select("id")
      .eq("engagement_id", engagementId)
      .eq("status", "fully_executed")
      .limit(1)
      .maybeSingle();
    if (executedContract) {
      return NextResponse.json(
        {
          error:
            "This engagement has a signed agreement, which requires 14 days' notice to end. Use \"End with notice\" instead.",
        },
        { status: 409 }
      );
    }

    // Update engagement status — DB trigger handles candidate lock release
    await admin
      .from("engagements")
      .update({
        status: "released",
        lock_released_at: new Date().toISOString(),
      })
      .eq("id", engagementId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Release engagement error:", error);
    return NextResponse.json({ error: "Failed to release" }, { status: 500 });
  }
}
