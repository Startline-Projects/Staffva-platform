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
 * GET /api/dashboard/stats
 *
 * Returns all dashboard data for the authenticated client.
 */
export async function GET() {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || user.user_metadata?.role !== "client") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const admin = getAdminClient();

    const { data: client } = await admin
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const clientId = client.id;

    // ═══ STAT CARDS ═══

    // 1. Active hires
    const { count: activeHires } = await admin
      .from("engagements")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "active");

    // 2. Candidates contacted (distinct candidate_id in messages)
    const { data: messageThreads } = await admin
      .from("messages")
      .select("candidate_id")
      .eq("client_id", clientId);

    const uniqueContacted = new Set((messageThreads || []).map((m) => m.candidate_id)).size;

    // 3. Interviews completed
    let interviewsCompleted = 0;
    try {
      const { count } = await admin
        .from("interview_requests")
        .select("*", { count: "exact", head: true })
        .eq("client_id", clientId)
        .eq("payment_status", "paid");
      interviewsCompleted = count || 0;
    } catch { /* table may not exist */ }

    // 4. Total platform spend
    // Sum payment_periods amounts for this client's engagements
    const { data: engagementIds } = await admin
      .from("engagements")
      .select("id")
      .eq("client_id", clientId);

    let totalSpend = 0;
    const engIds = (engagementIds || []).map((e) => e.id);

    if (engIds.length > 0) {
      const { data: periods } = await admin
        .from("payment_periods")
        .select("amount_usd")
        .in("engagement_id", engIds)
        .in("status", ["funded", "released"]);

      totalSpend = (periods || []).reduce((sum, p) => sum + Number(p.amount_usd || 0), 0);
    }

    // Add service_orders spend
    try {
      const { data: orders } = await admin
        .from("service_orders")
        .select("service_packages(price_usd)")
        .eq("client_id", clientId)
        .in("status", ["completed", "in_progress", "submitted"]);

      if (orders) {
        for (const o of orders) {
          const pkg = o.service_packages as unknown as { price_usd: number } | null;
          if (pkg) totalSpend += Number(pkg.price_usd || 0);
        }
      }
    } catch { /* table may not exist */ }

    // ═══ HIRING ACTIVITY (monthly hires for past 12 months) ═══
    const { data: allEngagements } = await admin
      .from("engagements")
      .select("created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true });

    const months: { month: string; count: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-US", { month: "short" });
      const count = (allEngagements || []).filter((e) => {
        const eDate = new Date(e.created_at);
        return eDate.getFullYear() === d.getFullYear() && eDate.getMonth() === d.getMonth();
      }).length;
      months.push({ month: label, count });
    }

    // ═══ PIPELINE ═══

    // Browsed — unique candidates this client viewed
    const { count: browsedCount } = await admin
      .from("profile_views")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId);

    // Messaged — unique candidates with message threads
    const messaged = uniqueContacted;

    // Interviewed
    const interviewed = interviewsCompleted;

    // Contracted — active engagements
    const contracted = activeHires || 0;

    // ═══ TOP MATCHES ═══
    // Get candidates this client has browsed or messaged
    const { data: viewedCandidates } = await admin
      .from("profile_views")
      .select("candidate_id")
      .eq("client_id", clientId);

    const browsedIds = (viewedCandidates || []).map((v) => v.candidate_id);
    const messagedIds = (messageThreads || []).map((m) => m.candidate_id);
    const poolIds = [...new Set([...browsedIds, ...messagedIds])];

    let topMatches: { id: string; display_name: string; role_category: string; profile_photo_url: string | null; overall_score: number }[] = [];

    if (poolIds.length > 0) {
      // Get AI interview scores for pool
      const { data: aiScores } = await admin
        .from("ai_interviews")
        .select("candidate_id, overall_score")
        .in("candidate_id", poolIds)
        .eq("status", "completed")
        .eq("passed", true)
        .order("overall_score", { ascending: false });

      // Get top 4 unique candidates by score
      const seen = new Set<string>();
      const topCandidateIds: string[] = [];
      for (const ai of aiScores || []) {
        if (!seen.has(ai.candidate_id) && ai.overall_score) {
          seen.add(ai.candidate_id);
          topCandidateIds.push(ai.candidate_id);
          if (topCandidateIds.length >= 4) break;
        }
      }

      if (topCandidateIds.length > 0) {
        const { data: candidates } = await admin
          .from("candidates")
          .select("id, display_name, role_category, profile_photo_url")
          .in("id", topCandidateIds)
          .eq("admin_status", "approved");

        const scoreMap: Record<string, number> = {};
        for (const ai of aiScores || []) {
          if (!scoreMap[ai.candidate_id] && ai.overall_score) {
            scoreMap[ai.candidate_id] = ai.overall_score;
          }
        }

        topMatches = (candidates || [])
          .map((c) => ({
            ...c,
            overall_score: scoreMap[c.id] || 0,
          }))
          .sort((a, b) => b.overall_score - a.overall_score)
          .slice(0, 4);
      }

      // If no AI scores, fall back to recently viewed candidates
      if (topMatches.length === 0 && poolIds.length > 0) {
        const { data: fallback } = await admin
          .from("candidates")
          .select("id, display_name, role_category, profile_photo_url")
          .in("id", poolIds.slice(0, 4))
          .eq("admin_status", "approved");

        topMatches = (fallback || []).map((c) => ({ ...c, overall_score: 0 }));
      }
    }

    return NextResponse.json({
      clientId,
      stats: {
        activeHires: activeHires || 0,
        candidatesContacted: uniqueContacted,
        interviewsCompleted,
        totalSpend: Math.round(totalSpend * 100) / 100,
      },
      hiringActivity: months,
      pipeline: {
        browsed: browsedCount || 0,
        messaged,
        interviewed,
        contracted,
      },
      topMatches,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
