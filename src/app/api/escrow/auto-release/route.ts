import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { initiatePayout } from "@/lib/payouts";
import { hasCronSecret } from "@/lib/auth";

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
  // Internal scheduler only. This was previously fail-OPEN — the check was
  // `if (cronSecret && ...)`, so with CRON_SECRET unset the guard was skipped
  // entirely and anyone could POST to release escrowed funds. hasCronSecret()
  // fails closed instead. Especially important now that this route actually
  // transfers money rather than just logging.
  if (!hasCronSecret(request)) {
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
      // Compare-and-swap: only release a period that is still 'funded'. If the
      // client released it manually in the meantime (or a previous cron run
      // already handled it), this affects 0 rows and we skip — so the two paths
      // can never both pay.
      const { data: releasedPeriod } = await admin
        .from("payment_periods")
        .update({ status: "released", released_at: now })
        .eq("id", period.id)
        .eq("status", "funded")
        .select("id")
        .maybeSingle();

      if (releasedPeriod) {
        // Actually move the money. This previously only console.logged, so
        // auto-released periods marked the candidate paid (and incremented
        // their verified earnings via the DB trigger) without ever transferring.
        await initiatePayout(
          admin,
          periodData.engagements.candidate_id,
          Number(periodData.amount_usd),
          "period",
          period.id
        );
        results.periodsReleased++;
      }
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
      // Compare-and-swap — see the period branch above.
      const { data: releasedMilestone } = await admin
        .from("milestones")
        .update({
          status: "released",
          approved_at: now,
          released_at: now,
        })
        .eq("id", milestone.id)
        .eq("status", "candidate_marked_complete")
        .select("id")
        .maybeSingle();

      if (releasedMilestone) {
        await initiatePayout(
          admin,
          msData.engagements.candidate_id,
          Number(msData.amount_usd),
          "milestone",
          milestone.id
        );
        results.milestonesReleased++;
      }
    }
  }

  return NextResponse.json({ success: true, ...results });
}
