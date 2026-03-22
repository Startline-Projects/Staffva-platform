import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/screening
 *
 * AI candidate screening via Anthropic Claude claude-sonnet-4-6.
 * Called async after application form submission — does not block the candidate.
 * Stores result in candidates table and screening_log.
 *
 * Body: { candidateId }
 */
export async function POST(request: Request) {
  try {
    const { candidateId } = await request.json();

    if (!candidateId) {
      return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });
    }

    const supabase = getAdminClient();

    // Fetch candidate application data
    const { data: candidate } = await supabase
      .from("candidates")
      .select(
        "full_name, email, country, role_category, years_experience, monthly_rate, bio, us_client_experience, us_client_description"
      )
      .eq("id", candidateId)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    // Build the screening prompt
    const candidateData = `
Full Name: ${candidate.full_name}
Country: ${candidate.country}
Role Category: ${candidate.role_category}
Years of Experience: ${candidate.years_experience}
Monthly Rate: $${candidate.monthly_rate}
Bio: ${candidate.bio || "Not provided"}
US Client Experience: ${candidate.us_client_experience}
US Client Description: ${candidate.us_client_description || "Not provided"}
    `.trim();

    const systemPrompt = `You are screening offshore professional candidates for U.S. law firms and accounting firms. Based on the candidate application below, return ONLY a valid JSON object with exactly three fields: tag, score, and reason. No other text. No markdown. No explanation outside the JSON.

Scoring rules: Tag as Priority if they have 3+ years experience in paralegal, legal assistant, or bookkeeping roles AND have US client experience AND their bio is written in clear professional English. Tag as Hold if they have under 1 year experience OR their bio has significant grammar issues OR their role category is completely unrelated to legal or accounting work. Tag everything else as Review.

Score from 1-10 where 10 is a perfect candidate for a U.S. law firm or accounting firm.

Candidate data:
${candidateData}

Return only this format: {"tag": "Priority" or "Review" or "Hold", "score": number, "reason": "one sentence"}`;

    let tag = "Review";
    let score = 5;
    let reason = "Screening pending manual review";
    let errorMsg: string | null = null;

    try {
      // Call Anthropic API with 10-second timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6-20250514",
          max_tokens: 200,
          messages: [
            {
              role: "user",
              content: systemPrompt,
            },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${errBody}`);
      }

      const data = await response.json();
      const content = data.content?.[0]?.text || "";

      // Parse JSON from response — handle potential markdown wrapping
      const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(jsonStr);

      if (parsed.tag && ["Priority", "Review", "Hold"].includes(parsed.tag)) {
        tag = parsed.tag;
      }
      if (typeof parsed.score === "number" && parsed.score >= 1 && parsed.score <= 10) {
        score = parsed.score;
      }
      if (typeof parsed.reason === "string") {
        reason = parsed.reason;
      }
    } catch (err) {
      // API failure — default to Review, log the error
      errorMsg =
        err instanceof Error ? err.message : "Unknown screening error";
      console.error(`[Screening] Error for candidate ${candidateId}:`, errorMsg);
      tag = "Review";
      score = 5;
      reason = "Automated screening unavailable — queued for manual review";
    }

    // Update candidate record
    await supabase
      .from("candidates")
      .update({
        screening_tag: tag,
        screening_score: score,
        screening_reason: reason,
      })
      .eq("id", candidateId);

    // Log to screening_log
    await supabase.from("screening_log").insert({
      candidate_id: candidateId,
      tag,
      score,
      reason,
      error: errorMsg,
    });

    return NextResponse.json({ tag, score, reason });
  } catch (error) {
    console.error("Screening route error:", error);
    return NextResponse.json(
      { error: "Screening failed" },
      { status: 500 }
    );
  }
}
