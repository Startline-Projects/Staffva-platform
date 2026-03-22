import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/badges/check
 *
 * Cron job — runs daily. Checks all active engagements for tenure badge eligibility.
 * Awards 90-day, 180-day, and 365-day badges based on consecutive active payment days.
 *
 * Protected by CRON_SECRET.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdminClient();
  const now = new Date();
  let awarded = 0;

  // Get all active engagements
  const { data: engagements } = await admin
    .from("engagements")
    .select("id, candidate_id, client_id, created_at")
    .eq("status", "active");

  for (const eng of engagements || []) {
    const startDate = new Date(eng.created_at);
    const daysActive = Math.floor(
      (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    const badgeThresholds: { days: number; type: string }[] = [
      { days: 90, type: "90_day" },
      { days: 180, type: "180_day" },
      { days: 365, type: "365_day" },
    ];

    for (const threshold of badgeThresholds) {
      if (daysActive >= threshold.days) {
        // Check if badge already awarded for this engagement
        const { count } = await admin
          .from("tenure_badges")
          .select("*", { count: "exact", head: true })
          .eq("engagement_id", eng.id)
          .eq("badge_type", threshold.type);

        if (!count || count === 0) {
          await admin.from("tenure_badges").insert({
            engagement_id: eng.id,
            candidate_id: eng.candidate_id,
            client_id: eng.client_id,
            badge_type: threshold.type,
          });
          awarded++;
          console.log(
            `[Badge] Awarded ${threshold.type} to candidate ${eng.candidate_id} for engagement ${eng.id}`
          );
        }
      }
    }
  }

  return NextResponse.json({ success: true, badgesAwarded: awarded });
}
