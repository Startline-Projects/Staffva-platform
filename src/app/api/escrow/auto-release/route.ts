import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/escrow/auto-release
 *
 * Called on a schedule (e.g. cron every 15 minutes) to check for
 * payment periods and milestones that have passed their auto-release time.
 *
 * - Ongoing periods: auto-release 48 hours after period_end
 * - Project milestones: auto-release 7 days after candidate marks complete
 *
 * Protected by a simple API key in production.
 */
export async function POST(request: Request) {
  // Simple auth check for cron calls
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdminClient();
  const now = new Date().toISOString();
  const results = { periodsReleased: 0, milestonesReleased: 0 };

  // --- Auto-release payment periods (48h after period_end) ---
  const { data: duePeriods } = await admin
    .from("payment_periods")
    .select("id, engagement_id")
    .eq("status", "funded")
    .lte("auto_release_at", now);

  for (const period of duePeriods || []) {
    // Check no active dispute
    const { count } = await admin
      .from("disputes")
      .select("*", { count: "exact", head: true })
      .eq("period_id", period.id)
      .is("resolved_at", null);

    if (count && count > 0) continue; // skip — dispute pending

    // Release via the release API logic
    const { data: periodData } = await admin
      .from("payment_periods")
      .select("*, engagements!inner(candidate_id, candidate_rate_usd)")
      .eq("id", period.id)
      .single();

    if (periodData) {
      await admin
        .from("payment_periods")
        .update({ status: "released", released_at: now })
        .eq("id", period.id);

      // Log payout (Trolley integration will replace this)
      console.log(
        `[Auto-Release] Period ${period.id} — $${periodData.engagements.candidate_rate_usd} to candidate ${periodData.engagements.candidate_id}`
      );
      results.periodsReleased++;
    }
  }

  // --- Auto-release milestones (7 days after candidate marks complete) ---
  const { data: dueMilestones } = await admin
    .from("milestones")
    .select("id, engagement_id")
    .eq("status", "candidate_marked_complete")
    .lte("auto_release_at", now);

  for (const milestone of dueMilestones || []) {
    // Check no active dispute
    const { count } = await admin
      .from("disputes")
      .select("*", { count: "exact", head: true })
      .eq("milestone_id", milestone.id)
      .is("resolved_at", null);

    if (count && count > 0) continue;

    const { data: msData } = await admin
      .from("milestones")
      .select("*, engagements!inner(candidate_id)")
      .eq("id", milestone.id)
      .single();

    if (msData) {
      await admin
        .from("milestones")
        .update({
          status: "released",
          approved_at: now,
          released_at: now,
        })
        .eq("id", milestone.id);

      console.log(
        `[Auto-Release] Milestone ${milestone.id} — $${msData.amount_usd} to candidate ${msData.engagements.candidate_id}`
      );
      results.milestonesReleased++;
    }
  }

  return NextResponse.json({ success: true, ...results });
}
