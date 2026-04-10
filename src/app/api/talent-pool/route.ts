import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function verifyAccess(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ).auth.getUser(token);
  if (!user) return null;
  const supabase = getAdminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !["admin", "recruiting_manager"].includes(profile.role)) return null;
  return user;
}

// Pipeline stage classification
function classifyStage(c: {
  english_mc_score: number | null;
  english_written_tier: string | null;
  id_verification_status: string | null;
  profile_completed_at: string | null;
  second_interview_status: string | null;
  admin_status: string | null;
  screening_score: number | null;
}): string {
  // Approved candidates are "live" not pipeline
  if (c.admin_status === "approved") return "live";
  if (c.admin_status === "deactivated" || c.admin_status === "rejected") return "excluded";

  // Pending approval
  if (c.admin_status === "pending_2nd_interview" || c.admin_status === "pending_review" || c.admin_status === "active" || c.admin_status === "profile_review") return "pending_approval";

  // Second interview
  if (c.second_interview_status === "scheduled" || c.second_interview_status === "completed") return "second_interview";

  // AI interview — has screening score means AI interview done
  if (c.screening_score != null) return "ai_interview";

  // Profile builder
  if (c.profile_completed_at) return "profile_builder";

  // ID verification
  if (c.id_verification_status && c.id_verification_status !== "pending") return "id_verification";

  // English test
  if (c.english_mc_score != null || c.english_written_tier) return "english_test";

  // Applied (earliest stage)
  return "applied";
}

export async function GET(req: NextRequest) {
  const user = await verifyAccess(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getAdminClient();

  // Fetch all candidates with relevant fields
  const { data: candidates, error } = await supabase
    .from("candidates")
    .select("id, role_category, role_category_custom, admin_status, english_mc_score, english_written_tier, id_verification_status, profile_completed_at, second_interview_status, screening_score, assigned_recruiter");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Aggregate by role_category
  const roleMap = new Map<string, {
    role: string;
    live: number;
    pending: number;
    stages: Record<string, number>;
  }>();

  for (const c of candidates || []) {
    const stage = classifyStage(c);
    if (stage === "excluded") continue;

    const roleKey = c.role_category === "Other" ? "__other__" : (c.role_category || "Unknown");

    if (!roleMap.has(roleKey)) {
      roleMap.set(roleKey, {
        role: roleKey === "__other__" ? "Custom Roles (Unrouted)" : roleKey,
        live: 0,
        pending: 0,
        stages: { applied: 0, english_test: 0, id_verification: 0, profile_builder: 0, ai_interview: 0, second_interview: 0, pending_approval: 0 },
      });
    }

    const entry = roleMap.get(roleKey)!;
    if (stage === "live") {
      entry.live++;
    } else {
      entry.pending++;
      if (entry.stages[stage] !== undefined) {
        entry.stages[stage]++;
      }
    }
  }

  // Convert to sorted array (live count desc)
  const roles = Array.from(roleMap.values())
    .sort((a, b) => b.live - a.live)
    .map((r) => ({
      ...r,
      pipelineRatio: r.live > 0 ? Math.round((r.pending / r.live) * 10) / 10 : r.pending > 0 ? 9999 : 0,
    }));

  return NextResponse.json({
    roles,
    lastUpdated: new Date().toISOString(),
  });
}
