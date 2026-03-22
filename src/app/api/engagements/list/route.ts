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
 * GET /api/engagements/list
 *
 * Returns all engagements for the current client with candidate details,
 * latest payment status, and milestone progress.
 */
export async function GET() {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.user_metadata?.role !== "client") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const admin = getAdminClient();

    // Get client record
    const { data: client } = await admin
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!client) {
      return NextResponse.json({ engagements: [] });
    }

    // Get all engagements with candidate info
    const { data: engagements } = await admin
      .from("engagements")
      .select("*")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false });

    if (!engagements || engagements.length === 0) {
      return NextResponse.json({ engagements: [], clientId: client.id });
    }

    // Get candidate details
    const candidateIds = [...new Set(engagements.map((e) => e.candidate_id))];
    const { data: candidates } = await admin
      .from("candidates")
      .select("id, full_name, display_name, role_category, lock_status")
      .in("id", candidateIds);

    const candidateMap = Object.fromEntries(
      (candidates || []).map((c) => [c.id, c])
    );

    // Get latest payment period for each ongoing engagement
    const ongoingIds = engagements
      .filter((e) => e.contract_type === "ongoing")
      .map((e) => e.id);

    const { data: periods } = await admin
      .from("payment_periods")
      .select("*")
      .in("engagement_id", ongoingIds.length > 0 ? ongoingIds : ["none"])
      .order("period_end", { ascending: false });

    // Group periods by engagement, get latest
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const latestPeriodMap: Record<string, any> = {};
    for (const p of periods || []) {
      if (!latestPeriodMap[p.engagement_id]) {
        latestPeriodMap[p.engagement_id] = p;
      }
    }

    // Get milestones for project engagements
    const projectIds = engagements
      .filter((e) => e.contract_type === "project")
      .map((e) => e.id);

    const { data: milestones } = await admin
      .from("milestones")
      .select("*")
      .in("engagement_id", projectIds.length > 0 ? projectIds : ["none"])
      .order("created_at", { ascending: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const milestoneMap: Record<string, any[]> = {};
    for (const m of milestones || []) {
      if (!milestoneMap[m.engagement_id]) {
        milestoneMap[m.engagement_id] = [];
      }
      milestoneMap[m.engagement_id]!.push(m);
    }

    // Get all payment history
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allPeriods: Record<string, any[]> = {};
    for (const p of periods || []) {
      if (!allPeriods[p.engagement_id]) {
        allPeriods[p.engagement_id] = [];
      }
      allPeriods[p.engagement_id]!.push(p);
    }

    // Enrich engagements
    const enriched = engagements.map((e) => ({
      ...e,
      candidate: candidateMap[e.candidate_id] || null,
      latest_period: latestPeriodMap[e.id] || null,
      milestones: milestoneMap[e.id] || [],
      payment_history: allPeriods[e.id] || [],
    }));

    return NextResponse.json({ engagements: enriched, clientId: client.id });
  } catch (error) {
    console.error("List engagements error:", error);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}
