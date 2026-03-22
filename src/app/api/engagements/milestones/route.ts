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
 * POST /api/engagements/milestones
 *
 * Actions on milestones:
 * - mark_complete: Candidate marks a milestone as complete (starts 48h dispute window + 7d auto-release)
 * - approve: Client approves and releases funds immediately
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { milestoneId, action } = await request.json();
    const role = user.user_metadata?.role;

    if (!milestoneId || !action) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const admin = getAdminClient();

    const { data: milestone } = await admin
      .from("milestones")
      .select("*, engagements!inner(client_id, candidate_id)")
      .eq("id", milestoneId)
      .single();

    if (!milestone) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    const now = new Date();

    // Candidate marks milestone as complete
    if (action === "mark_complete" && role === "candidate") {
      // Verify candidate owns this engagement
      const { data: candidate } = await admin
        .from("candidates")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!candidate || candidate.id !== milestone.engagements.candidate_id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }

      if (milestone.status !== "funded") {
        return NextResponse.json({ error: "Milestone must be funded first" }, { status: 400 });
      }

      // Set auto-release to 7 days from now
      const autoRelease = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      await admin
        .from("milestones")
        .update({
          status: "candidate_marked_complete",
          marked_complete_at: now.toISOString(),
          auto_release_at: autoRelease.toISOString(),
        })
        .eq("id", milestoneId);

      return NextResponse.json({ success: true, action: "marked_complete" });
    }

    // Client approves milestone — immediate release
    if (action === "approve" && role === "client") {
      const { data: client } = await admin
        .from("clients")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!client || client.id !== milestone.engagements.client_id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }

      if (
        milestone.status !== "candidate_marked_complete" &&
        milestone.status !== "funded"
      ) {
        return NextResponse.json({ error: "Milestone not ready for approval" }, { status: 400 });
      }

      // Release via the escrow release API
      const releaseRes = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/escrow/release`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ milestoneId, triggeredBy: "client" }),
        }
      );

      if (!releaseRes.ok) {
        const err = await releaseRes.json();
        return NextResponse.json({ error: err.error }, { status: 400 });
      }

      return NextResponse.json({ success: true, action: "approved_and_released" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Milestone action error:", error);
    return NextResponse.json({ error: "Failed to process milestone" }, { status: 500 });
  }
}
