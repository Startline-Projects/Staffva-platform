import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { describeUsExperience, hasUsExperience } from "@/lib/usExperienceLabels";

const resend = new Resend(process.env.RESEND_API_KEY);

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const MAX_RETRIES = 5;
const BATCH_SIZE = 25;
const RATE_LIMIT_BACKOFF_MS = 2 * 60 * 1000; // 2 minutes

const SCREENING_PROMPT = `You are screening offshore professional candidates for U.S. law firms and accounting firms. Based on the candidate application below, return ONLY a valid JSON object with exactly three fields: tag, score, and reason. No other text. No markdown. No explanation outside the JSON.

Scoring rules: Tag as Priority if they have 3+ years experience in paralegal, legal assistant, or bookkeeping roles AND have any prior US client experience AND their bio is written in clear professional English. Tag as Hold if they have under 1 year experience OR their bio has significant grammar issues OR their role category is completely unrelated to legal or accounting work. Tag everything else as Review.

Score from 1-10 where 10 is a perfect candidate for a U.S. law firm or accounting firm.

Candidate data:
`;

// Runs every 60 seconds via Vercel Cron
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const supabase = getAdminClient();
  const now = new Date();
  const results = { processed: 0, failed: 0, rateLimited: 0, alerted: 0 };

  // Select pending + rate_limited items where retry is due
  const { data: items } = await supabase
    .from("screening_queue")
    .select("*")
    .or(`status.eq.pending,and(status.eq.rate_limited,next_retry_at.lte.${now.toISOString()})`)
    .lt("retry_count", MAX_RETRIES)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (!items || items.length === 0) {
    // Check for permanent failures to alert
    await alertPermanentFailures(supabase);
    return NextResponse.json({ message: "No pending screening jobs", ...results });
  }

  for (const item of items) {
    // Mark as processing
    await supabase
      .from("screening_queue")
      .update({ status: "processing" })
      .eq("id", item.id)
      .in("status", ["pending", "rate_limited"]);

    // Fetch candidate data
    const { data: candidate } = await supabase
      .from("candidates")
      .select("full_name, email, country, role_category, years_experience, hourly_rate, bio, us_client_experience, skills, tools")
      .eq("id", item.candidate_id)
      .single();

    if (!candidate) {
      await supabase
        .from("screening_queue")
        .update({
          status: "failed",
          error_text: "Candidate not found",
          retry_count: item.retry_count + 1,
        })
        .eq("id", item.id);
      results.failed++;
      continue;
    }

    // Build candidate summary for Claude
    const candidateSummary = JSON.stringify({
      name: candidate.full_name,
      country: candidate.country,
      role: candidate.role_category,
      experience: candidate.years_experience,
      rate: `$${candidate.hourly_rate}/hrnth`,
      bio: candidate.bio || "No bio provided",
      us_experience: describeUsExperience(candidate.us_client_experience),
      has_us_experience: hasUsExperience(candidate.us_client_experience) ? "yes" : "no",
      skills: candidate.skills || [],
      tools: candidate.tools || [],
    }, null, 2);

    try {
      // Call Claude API with 10-second timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 200,
          messages: [
            {
              role: "user",
              content: SCREENING_PROMPT + candidateSummary + '\n\nReturn only this format: {"tag": "Priority or Review or Hold", "score": number, "reason": "one sentence"}',
            },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Check for rate limit
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const backoff = retryAfter ? parseInt(retryAfter) * 1000 : RATE_LIMIT_BACKOFF_MS;
        const nextRetry = new Date(Date.now() + backoff);

        await supabase
          .from("screening_queue")
          .update({
            status: "rate_limited",
            next_retry_at: nextRetry.toISOString(),
            retry_count: item.retry_count + 1,
            error_text: `Rate limited — retry at ${nextRetry.toISOString()}`,
          })
          .eq("id", item.id);

        results.rateLimited++;
        // Stop processing batch — back off entirely
        break;
      }

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API error ${response.status}: ${errorBody.slice(0, 200)}`);
      }

      const data = await response.json();
      const content = data.content?.[0]?.text || "";

      // Parse JSON response
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        throw new Error(`Invalid JSON response: ${content.slice(0, 200)}`);
      }

      const screening = JSON.parse(jsonMatch[0]);
      const tag = screening.tag || "Review";
      const score = Math.min(10, Math.max(1, parseInt(screening.score) || 5));
      const reason = (screening.reason || "").slice(0, 500);

      // Write results to candidates table
      await supabase
        .from("candidates")
        .update({
          screening_tag: tag,
          screening_score: score,
          screening_reason: reason,
        })
        .eq("id", item.candidate_id);

      // Mark screening complete
      await supabase
        .from("screening_queue")
        .update({
          status: "complete",
          processed_at: new Date().toISOString(),
          error_text: null,
        })
        .eq("id", item.id);

      results.processed++;

      // Small delay between API calls to avoid bursting
      await new Promise((resolve) => setTimeout(resolve, 200));

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      const isAbort = err instanceof Error && err.name === "AbortError";

      await supabase
        .from("screening_queue")
        .update({
          status: "failed",
          error_text: isAbort ? "API timeout (10s)" : `Attempt ${item.retry_count + 1}: ${errorMsg}`,
          retry_count: item.retry_count + 1,
          next_retry_at: new Date(Date.now() + 60000).toISOString(), // Retry in 1 minute
        })
        .eq("id", item.id);

      results.failed++;
    }
  }

  // Reset retryable failed items back to pending
  await supabase
    .from("screening_queue")
    .update({ status: "pending" })
    .eq("status", "failed")
    .lt("retry_count", MAX_RETRIES)
    .not("next_retry_at", "is", null)
    .lte("next_retry_at", now.toISOString());

  // Alert on permanent failures
  await alertPermanentFailures(supabase);

  return NextResponse.json({
    message: `Screening: processed ${results.processed}, failed ${results.failed}, rate_limited ${results.rateLimited}`,
    ...results,
  });
}

async function alertPermanentFailures(supabase: ReturnType<typeof getAdminClient>) {
  const { data: failures } = await supabase
    .from("screening_queue")
    .select("id, candidate_id, error_text, retry_count, created_at")
    .eq("status", "failed")
    .gte("retry_count", MAX_RETRIES)
    .is("processed_at", null)
    .limit(20);

  if (!failures || failures.length === 0 || !process.env.RESEND_API_KEY) return;

  // Get candidate names for the alert
  const candidateIds = failures.map((f) => f.candidate_id);
  const { data: candidates } = await supabase
    .from("candidates")
    .select("id, display_name, full_name, email")
    .in("id", candidateIds);

  const candidateMap = new Map(
    (candidates || []).map((c) => [c.id, c])
  );

  const rows = failures
    .map((f) => {
      const c = candidateMap.get(f.candidate_id);
      return `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${c?.display_name || c?.full_name || "Unknown"}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${c?.email || "Unknown"}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;color:red;">${f.error_text || "Unknown"}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${f.retry_count}</td>
      </tr>`;
    })
    .join("");

  try {
    await resend.emails.send({
      from: "StaffVA <notifications@staffva.com>",
      to: "sam@glostaffing.com",
      subject: `⚠ ${failures.length} AI screening(s) permanently failed after ${MAX_RETRIES} retries`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:700px;margin:0 auto;padding:24px;">
          <h2 style="color:#1C1B1A;">AI Screening Queue Failure Alert</h2>
          <p style="color:#444;font-size:14px;">${failures.length} candidate screening(s) failed after ${MAX_RETRIES} attempts.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #e0e0e0;">
            <thead>
              <tr style="background:#f9f9f9;">
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Candidate</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Email</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Error</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Retries</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="color:#444;font-size:14px;">These candidates need manual screening tag assignment in the admin panel.</p>
        </div>
      `,
    });

    // Mark as alerted
    for (const f of failures) {
      await supabase
        .from("screening_queue")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", f.id);
    }
  } catch { /* silent */ }
}
