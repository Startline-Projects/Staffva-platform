import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface EscrowItem {
  type: "payment_period" | "milestone";
  id: string;
  engagement_id?: string;
  candidate_name?: string;
  client_name?: string;
  amount_usd: number;
  status: string;
  funded_at: string | null;
  auto_release_at: string | null;
  period_start?: string;
  period_end?: string;
  title?: string;
  submitted_at?: string | null;
}

// GET — fetch escrow status for a user (client or candidate)
export async function GET(req: NextRequest) {
  try {
    const supabase = getAdminClient();

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
    } = await createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ).auth.getUser(token);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Determine user role
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const items: EscrowItem[] = [];

    if (profile.role === "client") {
      // Get client record
      const { data: client } = await supabase
        .from("clients")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!client) {
        return NextResponse.json({ escrow: [] });
      }

      // Funded payment periods (escrow held)
      const { data: periods } = await supabase
        .from("payment_periods")
        .select(`
          id, engagement_id, period_start, period_end, amount_usd, status,
          funded_at, auto_release_at,
          engagements!inner(candidate_id, candidates!inner(display_name))
        `)
        .eq("status", "funded")
        .in("engagement_id", (
          await supabase
            .from("engagements")
            .select("id")
            .eq("client_id", client.id)
        ).data?.map((e: { id: string }) => e.id) || []);

      if (periods) {
        for (const p of periods) {
          const eng = p.engagements as unknown as Record<string, unknown>;
          const cand = eng?.candidates as unknown as Record<string, unknown>;
          items.push({
            type: "payment_period",
            id: p.id,
            engagement_id: p.engagement_id,
            candidate_name: (cand?.display_name as string) || "Unknown",
            amount_usd: p.amount_usd,
            status: p.status,
            funded_at: p.funded_at,
            auto_release_at: p.auto_release_at,
            period_start: p.period_start,
            period_end: p.period_end,
          });
        }
      }

      // Milestones in escrow (funded or candidate_marked_complete)
      const { data: milestones } = await supabase
        .from("milestones")
        .select(`
          id, engagement_id, title, amount_usd, status,
          funded_at, auto_release_at,
          engagements!inner(candidate_id, candidates!inner(display_name))
        `)
        .in("status", ["funded", "candidate_marked_complete"])
        .in("engagement_id", (
          await supabase
            .from("engagements")
            .select("id")
            .eq("client_id", client.id)
        ).data?.map((e: { id: string }) => e.id) || []);

      if (milestones) {
        for (const m of milestones) {
          const eng = m.engagements as unknown as Record<string, unknown>;
          const cand = eng?.candidates as unknown as Record<string, unknown>;
          items.push({
            type: "milestone",
            id: m.id,
            engagement_id: m.engagement_id,
            candidate_name: (cand?.display_name as string) || "Unknown",
            amount_usd: m.amount_usd,
            status: m.status,
            funded_at: m.funded_at,
            auto_release_at: m.auto_release_at,
            title: m.title,
          });
        }
      }

    } else if (profile.role === "candidate") {
      // Get candidate record
      const { data: candidate } = await supabase
        .from("candidates")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!candidate) {
        return NextResponse.json({ escrow: [] });
      }

      // Payment periods where candidate has funds in escrow
      const { data: periods } = await supabase
        .from("payment_periods")
        .select(`
          id, engagement_id, period_start, period_end, amount_usd, status,
          funded_at, auto_release_at
        `)
        .eq("status", "funded")
        .in("engagement_id", (
          await supabase
            .from("engagements")
            .select("id")
            .eq("candidate_id", candidate.id)
        ).data?.map((e: { id: string }) => e.id) || []);

      if (periods) {
        for (const p of periods) {
          items.push({
            type: "payment_period",
            id: p.id,
            engagement_id: p.engagement_id,
            amount_usd: p.amount_usd,
            status: p.status,
            funded_at: p.funded_at,
            auto_release_at: p.auto_release_at,
            period_start: p.period_start,
            period_end: p.period_end,
          });
        }
      }

      // Milestones
      const { data: milestones } = await supabase
        .from("milestones")
        .select(`
          id, engagement_id, title, amount_usd, status,
          funded_at, auto_release_at
        `)
        .in("status", ["funded", "candidate_marked_complete"])
        .in("engagement_id", (
          await supabase
            .from("engagements")
            .select("id")
            .eq("candidate_id", candidate.id)
        ).data?.map((e: { id: string }) => e.id) || []);

      if (milestones) {
        for (const m of milestones) {
          items.push({
            type: "milestone",
            id: m.id,
            engagement_id: m.engagement_id,
            amount_usd: m.amount_usd,
            status: m.status,
            funded_at: m.funded_at,
            auto_release_at: m.auto_release_at,
            title: m.title,
          });
        }
      }

    }

    // Calculate totals
    const totalInEscrow = items.reduce((sum, item) => sum + Number(item.amount_usd), 0);

    return NextResponse.json({
      escrow: items,
      total_in_escrow: totalInEscrow,
      count: items.length,
    });
  } catch (err) {
    console.error("Escrow status error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
