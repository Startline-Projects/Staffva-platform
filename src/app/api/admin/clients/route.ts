import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.user_metadata?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const admin = getAdminClient();

  const { data: clients } = await admin
    .from("clients")
    .select("*")
    .order("created_at", { ascending: false });

  // Get engagement counts and total fees per client
  const clientIds = (clients || []).map((c) => c.id);

  const { data: engagements } = await admin
    .from("engagements")
    .select("client_id, status, platform_fee_usd")
    .in("client_id", clientIds.length > 0 ? clientIds : ["none"]);

  const engagementStats: Record<
    string,
    { active: number; totalFees: number }
  > = {};

  for (const eng of engagements || []) {
    if (!engagementStats[eng.client_id]) {
      engagementStats[eng.client_id] = { active: 0, totalFees: 0 };
    }
    if (eng.status === "active") {
      engagementStats[eng.client_id].active++;
    }
    engagementStats[eng.client_id].totalFees += Number(eng.platform_fee_usd) || 0;
  }

  const enriched = (clients || []).map((c) => ({
    ...c,
    active_engagements: engagementStats[c.id]?.active || 0,
    total_fees_usd: engagementStats[c.id]?.totalFees || 0,
  }));

  return NextResponse.json({ clients: enriched });
}
