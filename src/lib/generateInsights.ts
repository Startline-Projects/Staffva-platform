import { createClient } from "@supabase/supabase-js";
import { describeUsExperience } from "@/lib/usExperienceLabels";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * Generate two AI-powered insights for a candidate profile.
 * Assembles data from three sources: candidate profile, AI interview, second interview scorecard.
 * Calls Claude claude-sonnet-4-6 and writes results to candidates table.
 * On failure: logs error, leaves existing insight values untouched.
 */
export async function generateInsights(candidateId: string): Promise<void> {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("[AI Insights] ANTHROPIC_API_KEY not configured");
      return;
    }

    const supabase = getAdminClient();

    // ── Source 1: Candidate profile fields ──
    const { data: candidate, error: candidateErr } = await supabase
      .from("candidates")
      .select("display_name, full_name, role_category, tagline, bio, skills, tools, work_experience, hourly_rate, country, english_written_tier, us_client_experience, total_earnings_usd, reputation_score, reputation_tier")
      .eq("id", candidateId)
      .single();

    if (candidateErr || !candidate) {
      console.error("[AI Insights] Candidate not found:", candidateId, candidateErr);
      return;
    }

    // ── Source 2: AI interview scores ──
    const { data: aiInterview } = await supabase
      .from("ai_interviews")
      .select("overall_score, technical_knowledge_score, problem_solving_score, communication_score, experience_depth_score, professionalism_score, passed, badge_level")
      .eq("candidate_id", candidateId)
      .eq("status", "completed")
      .eq("passed", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // ── Source 3: Second interview scorecard ──
    const { data: secondInterview } = await supabase
      .from("candidate_interviews")
      .select("communication_score, demeanor_score, role_knowledge_score, notes_pdf_url")
      .eq("candidate_id", candidateId)
      .eq("status", "completed")
      .order("conducted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // ── Assemble prompt data ──
    const profileSummary = [
      `Name: ${candidate.display_name || candidate.full_name}`,
      `Role: ${candidate.role_category}`,
      candidate.tagline ? `Tagline: ${candidate.tagline}` : null,
      candidate.bio ? `Bio: ${candidate.bio}` : null,
      candidate.skills?.length ? `Skills: ${candidate.skills.join(", ")}` : null,
      candidate.tools?.length ? `Tools: ${candidate.tools.join(", ")}` : null,
      candidate.work_experience?.length ? `Work experience: ${JSON.stringify(candidate.work_experience)}` : null,
      `Hourly rate: $${candidate.hourly_rate}`,
      `Country: ${candidate.country}`,
      candidate.english_written_tier ? `English written tier: ${candidate.english_written_tier}` : null,
      candidate.us_client_experience ? `US client experience: ${describeUsExperience(candidate.us_client_experience)}` : null,
      candidate.total_earnings_usd > 0 ? `Verified earnings: $${candidate.total_earnings_usd}` : null,
      candidate.reputation_score ? `Reputation score: ${candidate.reputation_score}%` : null,
      candidate.reputation_tier ? `Reputation tier: ${candidate.reputation_tier}` : null,
    ].filter(Boolean).join("\n");

    let aiInterviewSummary = "";
    if (aiInterview) {
      aiInterviewSummary = `\n\nAI Interview Results (passed: ${aiInterview.passed}, badge: ${aiInterview.badge_level || "none"}):\n` +
        `Overall: ${aiInterview.overall_score}/100, Technical: ${aiInterview.technical_knowledge_score}/100, Problem Solving: ${aiInterview.problem_solving_score}/100, Communication: ${aiInterview.communication_score}/100, Experience Depth: ${aiInterview.experience_depth_score}/100, Professionalism: ${aiInterview.professionalism_score}/100`;
    }

    let secondInterviewSummary = "";
    if (secondInterview) {
      secondInterviewSummary = `\n\nSecond Interview Scorecard:\n` +
        `Communication: ${secondInterview.communication_score}/5, Demeanor: ${secondInterview.demeanor_score}/5, Role Knowledge: ${secondInterview.role_knowledge_score}/5`;
    }

    const userContent = profileSummary + aiInterviewSummary + secondInterviewSummary;

    // ── Call Claude API ──
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        system: `You are an insight generator for StaffVA, a professional talent marketplace connecting US clients with vetted remote professionals. Given a candidate's profile data, AI interview scores, and second interview scorecard, return a JSON array of exactly 2 strings. Each string is one specific, compelling insight a US client would value when evaluating this candidate. Max 20 words per insight. Be specific — reference actual skills, scores, or experience from the data. No generic statements like "strong communicator" or "hard worker". Focus on what makes this candidate uniquely valuable. Return only the JSON array, no other text.`,
        messages: [{ role: "user", content: userContent }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[AI Insights] Anthropic API error:", response.status, errBody);
      return;
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text || "";

    // Parse JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("[AI Insights] Could not parse JSON from response:", text);
      return;
    }

    let insights: string[];
    try {
      insights = JSON.parse(jsonMatch[0]);
    } catch {
      console.error("[AI Insights] JSON parse error:", text);
      return;
    }

    if (!Array.isArray(insights) || insights.length < 2) {
      console.error("[AI Insights] Expected array of 2 strings, got:", insights);
      return;
    }

    // ── Write results ──
    const { error: updateErr } = await supabase
      .from("candidates")
      .update({
        ai_insight_1: insights[0],
        ai_insight_2: insights[1],
        ai_insights_generated_at: new Date().toISOString(),
      })
      .eq("id", candidateId);

    if (updateErr) {
      console.error("[AI Insights] Failed to save insights:", updateErr);
      return;
    }

    console.log("[AI Insights] Generated for candidate:", candidateId);
  } catch (error) {
    console.error("[AI Insights] Unexpected error for candidate:", candidateId, error);
  }
}
