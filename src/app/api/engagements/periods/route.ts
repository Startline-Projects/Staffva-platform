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
 * POST /api/engagements/periods
 *
 * Creates the next payment period for an ongoing engagement.
 * Called when client clicks "Fund Next Period" in team portal.
 *
 * Body: { engagementId }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.user_metadata?.role !== "client") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { engagementId } = await request.json();

    if (!engagementId) {
      return NextResponse.json({ error: "engagementId required" }, { status: 400 });
    }

    const admin = getAdminClient();

    // Verify engagement belongs to this client and is ongoing
    const { data: engagement } = await admin
      .from("engagements")
      .select("*, clients!inner(user_id)")
      .eq("id", engagementId)
      .eq("contract_type", "ongoing")
      .single();

    if (!engagement || engagement.clients.user_id !== user.id) {
      return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
    }

    // Get the latest period to determine next period dates
    const { data: latestPeriod } = await admin
      .from("payment_periods")
      .select("*")
      .eq("engagement_id", engagementId)
      .order("period_end", { ascending: false })
      .limit(1)
      .single();

    const periodStart = latestPeriod
      ? new Date(latestPeriod.period_end)
      : new Date();

    const periodEnd = new Date(periodStart);

    switch (engagement.payment_cycle) {
      case "weekly":
        periodEnd.setDate(periodEnd.getDate() + 7);
        break;
      case "biweekly":
        periodEnd.setDate(periodEnd.getDate() + 14);
        break;
      case "monthly":
      default:
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        break;
    }

    const { data: newPeriod, error: periodError } = await admin
      .from("payment_periods")
      .insert({
        engagement_id: engagementId,
        period_start: periodStart.toISOString().split("T")[0],
        period_end: periodEnd.toISOString().split("T")[0],
        amount_usd: engagement.candidate_rate_usd,
      })
      .select()
      .single();

    if (periodError) {
      return NextResponse.json({ error: periodError.message }, { status: 500 });
    }

    return NextResponse.json({ period: newPeriod });
  } catch (error) {
    console.error("Create period error:", error);
    return NextResponse.json({ error: "Failed to create period" }, { status: 500 });
  }
}
