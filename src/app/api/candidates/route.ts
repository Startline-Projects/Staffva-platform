import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const search = searchParams.get("search");
  const role = searchParams.get("role");
  const country = searchParams.get("country");
  const minRate = searchParams.get("minRate");
  const maxRate = searchParams.get("maxRate");
  const availability = searchParams.get("availability");
  const tier = searchParams.get("tier");
  const usExperience = searchParams.get("usExperience");
  const skillsParam = searchParams.get("skills");
  const sort = searchParams.get("sort") || "newest";
  const page = parseInt(searchParams.get("page") || "1");
  const limit = 24;

  const supabase = getAdminClient();

  // Call the get_candidates_with_skills RPC — single query handles
  // all filtering, sorting, pagination, and skills aggregation
  const { data: rpcResult, error } = await supabase.rpc("get_candidates_with_skills", {
    p_search: search || null,
    p_role: role || null,
    p_country: country || null,
    p_min_rate: minRate ? parseInt(minRate) : null,
    p_max_rate: (maxRate && parseInt(maxRate) < 150) ? parseInt(maxRate) : null,
    p_availability: availability || null,
    p_tier: tier || null,
    p_us_experience: usExperience || null,
    p_skills: skillsParam ? skillsParam.split(",").map((s) => s.trim()).filter(Boolean) : null,
    p_sort: sort,
    p_page: page,
    p_page_size: limit,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const data = rpcResult?.candidates || [];
  const totalCount = rpcResult?.total || 0;
  const skillAggregation = rpcResult?.skill_aggregation || [];

  // Batch-fetch completed AI interviews for all returned candidates
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidateIds = (data || []).map((c: any) => c.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let aiInterviewMap: Record<string, any> = {};

  if (candidateIds.length > 0) {
    const { data: aiInterviews } = await supabase
      .from("ai_interviews")
      .select("candidate_id, overall_score, technical_knowledge_score, problem_solving_score, communication_score, experience_depth_score, professionalism_score, status, passed")
      .in("candidate_id", candidateIds)
      .eq("status", "completed")
      .eq("passed", true);

    if (aiInterviews) {
      for (const ai of aiInterviews) {
        // Keep the latest (first match since we don't order, but one per candidate typically)
        if (!aiInterviewMap[ai.candidate_id]) {
          aiInterviewMap[ai.candidate_id] = ai;
        }
      }
    }
  }

  // Merge AI interview data into candidates
  const enriched = (data || []).map((c: Record<string, unknown>) => ({
    ...c,
    ai_interview: aiInterviewMap[c.id as string] || null,
  }));

  return NextResponse.json({
    candidates: enriched,
    total: totalCount,
    page,
    totalPages: Math.ceil(totalCount / limit),
    skillAggregation,
  });
}
