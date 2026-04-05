import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * POST /api/admin/recruiter-scoring
 * Body: { candidateId, interviewNotes }
 * Sends notes to Claude API for scoring, stores results
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || (user.user_metadata?.role !== "admin" && user.user_metadata?.role !== "recruiter")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { candidateId, interviewNotes } = await req.json();
    if (!candidateId || !interviewNotes?.trim()) {
      return NextResponse.json({ error: "Missing candidateId or interviewNotes" }, { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "AI scoring not configured" }, { status: 500 });
    }

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
        max_tokens: 1000,
        system: `You are an interview scoring assistant for StaffVA, a professional talent marketplace. Based on the recruiter notes provided, score this candidate across the following five dimensions on a scale of 1 to 5 where 1 is poor and 5 is excellent: Professionalism, Communication Clarity, Cultural Fit, Reliability Indicators, Overall Recommendation. Return a JSON object only with no preamble. Structure: an array of objects each containing "dimension" as a string, "score" as a number 1 to 5, and "justification" as a one-sentence string.`,
        messages: [{ role: "user", content: interviewNotes.trim() }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json({ error: "AI scoring failed. Please try again." }, { status: 500 });
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text || "";

    // Extract JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "AI scoring failed. Please try again." }, { status: 500 });
    }

    let scores;
    try {
      scores = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json({ error: "AI scoring failed. Please try again." }, { status: 500 });
    }

    // Store results
    const admin = getAdminClient();
    await admin.from("candidates").update({
      recruiter_ai_score_results: scores,
    }).eq("id", candidateId);

    return NextResponse.json({ scores });
  } catch (error) {
    console.error("Recruiter scoring error:", error);
    return NextResponse.json({ error: "AI scoring failed. Please try again." }, { status: 500 });
  }
}
