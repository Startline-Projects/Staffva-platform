import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Approve everyone who has become ready but was not promoted at the moment they
 * became ready.
 *
 * A candidate goes live when the last of two things happens: passing the AI
 * interview, and finishing Build Your Profile. Both of those call
 * promote_candidate_if_ready directly, so this sweep should normally find
 * nothing to do. It exists for the case where that call did not land — a network
 * blip, a deploy mid-request, a browser closed before the profile save finished
 * its follow-up — because a candidate with no steps left of their own has
 * nothing that would ever trigger a retry. They would simply never go live, and
 * nobody would know, which is the failure mode this entire change set exists to
 * remove.
 *
 * The sweep does not decide anything. promote_candidate_if_ready (migration
 * 00116) is the only judge of readiness; this just makes sure it gets asked.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getAdminClient();

  const { data, error } = await supabase.rpc("promote_ready_candidates", { p_limit: 500 });

  // Fail loudly. A sweep that cannot run is indistinguishable from a sweep that
  // found nothing, and this one is the last line of defence for a candidate who
  // is qualified and invisible. alert-health notices a non-2xx cron.
  if (error) {
    console.error("[CRITICAL] promote-ready sweep failed:", error.message);
    return NextResponse.json({ error: "Sweep failed", detail: error.message }, { status: 500 });
  }

  const rows = (data || []) as Array<{ candidate_id: string; new_status: string }>;
  const promoted = rows.filter((r) => r.new_status === "approved");

  // Only worth a log line when it actually did something — this runs hourly and
  // the healthy case is silence.
  if (promoted.length > 0) {
    console.log(
      `[promote-ready] Promoted ${promoted.length} candidate(s) the direct path missed: ` +
        promoted.map((r) => r.candidate_id).join(", ")
    );
  }

  return NextResponse.json({
    checked: rows.length,
    promoted: promoted.length,
    promotedIds: promoted.map((r) => r.candidate_id),
  });
}
