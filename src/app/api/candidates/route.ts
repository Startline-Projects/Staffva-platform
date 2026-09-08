import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { maskCandidateText } from "@/lib/contactMask";
import { rolePatternsFor } from "@/lib/roleTaxonomy";

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
    // Pills map to the stored role values they cover; unknown values fall
    // back to substring matching (hero chips pass full role names).
    p_roles: role && role !== "All" ? rolePatternsFor(role) : null,
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
  const aiInterviewMap: Record<string, any> = {};

  // The canonical vetting fact is candidates.ai_interview_passed, NOT the
  // presence of an ai_interviews row: the 00143 re-verification reset left 52
  // scored interviews at status 'failed_technical', so the table holds ONE
  // completed+passed row while 30 people legitimately passed. The column is
  // the pre-reset truth every approval gate reads, so the badge reads it too.
  const assessedIds = new Set<string>();
  if (candidateIds.length > 0) {
    const { data: passedRows } = await supabase
      .from("candidates")
      .select("id")
      .in("id", candidateIds)
      .eq("ai_interview_passed", true);
    for (const r of passedRows ?? []) assessedIds.add(r.id as string);
  }

  if (candidateIds.length > 0) {
    const { data: aiInterviews } = await supabase
      .from("ai_interviews")
      .select("candidate_id, overall_score, technical_knowledge_score, problem_solving_score, communication_score, experience_depth_score, professionalism_score, status, passed")
      .eq("kind", "skills")
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

  // Merge AI interview data into candidates. This listing is the public
  // browse surface, so free text goes out with contact details masked —
  // and scorecard numbers only reach signed-in viewers, matching the
  // profile page's gate (the tier badge stays public; it's marketing).
  let signedIn = false;
  try {
    const authClient = await createServerClient();
    const { data: { user } } = await authClient.auth.getUser();
    signedIn = !!user;
  } catch {
    /* anonymous */
  }

  const enriched = (data || []).map((c: Record<string, unknown>) => {
    const masked = maskCandidateText(c) as Record<string, unknown>;
    if (!signedIn) {
      masked.english_mc_score = null;
      masked.english_comprehension_score = null;
      masked.english_percentile = null;
    }
    return {
      ...masked,
      ai_interview: signedIn ? aiInterviewMap[c.id as string] || null : null,
      // Whether this person has actually been through StaffVA's screening
      // interview. The map above holds ONLY completed+passed skills
      // interviews, so its presence IS the assessment fact — no new column,
      // nothing to drift. Deliberately NOT gated on signedIn: the scorecard
      // numbers are marketing-sensitive, but "has this person been vetted
      // at all" is the claim the public browse page makes on every card,
      // and hiding it from anonymous visitors is what would make the page
      // lie. See the owner's 2026-09-07 relist of the full pipeline.
      is_assessed: assessedIds.has(c.id as string),
    };
  });

  return NextResponse.json({
    candidates: enriched,
    total: totalCount,
    page,
    totalPages: Math.ceil(totalCount / limit),
    skillAggregation,
  });
}
