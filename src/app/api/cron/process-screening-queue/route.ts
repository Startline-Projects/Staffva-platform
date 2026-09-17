import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { describeUsExperience, hasUsExperience } from "@/lib/usExperienceLabels";
import { groupForRole } from "@/lib/candidateOptions";
import { SKILLS_BY_ROLE } from "@/lib/roleSkills";
import { extractText } from "@/lib/anthropic";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const MAX_RETRIES = 5;
const BATCH_SIZE = 25;
const RATE_LIMIT_BACKOFF_MS = 2 * 60 * 1000; // 2 minutes

/**
 * The screening rubric.
 *
 * The previous one opened "You are screening offshore professional candidates
 * for U.S. law firms and accounting firms" and tagged Hold for any "role
 * category completely unrelated to legal or accounting work". StaffVA recruits
 * across thirteen role families — Tech, Medical, Marketing, Real Estate,
 * Creative, Sales and the rest — so that clause auto-held four candidates in
 * five for applying to a job the platform advertises. The landing page says
 * "from paralegals to specialist VAs"; the screening only believed in the
 * paralegals.
 *
 * Two rules carry the weight here:
 *
 *   · Judge the candidate against THE ROLE THEY APPLIED FOR. A software
 *     engineer is not a weak paralegal. The role family is passed in so
 *     "related experience" is measured against the right family rather than
 *     against whatever the prompt happened to name.
 *
 *   · Missing information can never produce Hold. This is the whole lesson of
 *     the placeholder defect: screening ran against a stage-1 record the
 *     candidate had not filled in yet, the model correctly described an empty
 *     form, and 85% of the pool was branded unqualified for it. An empty field
 *     is an unfinished profile, not a weak candidate, and the two must not
 *     share an outcome.
 */
const SCREENING_PROMPT = `You are screening candidates for StaffVA, a marketplace placing offshore professionals with U.S. businesses. Candidates apply across many role families: Legal, Accounting & Finance, Administrative, Sales & Outreach, Marketing & SEO, Scheduling & Support, Medical, Real Estate, HR & Recruitment, Creative & Design, Operations & E-commerce, and Tech.

Judge this candidate ONLY against the role they applied for, shown in the "role" field, and against its family in "role_family". Do not measure them against any other profession. A Software Engineer is not a weak Paralegal — they are a different role and are scored as a Software Engineer.

Return ONLY a valid JSON object with exactly three fields: tag, score, and reason. No other text. No markdown. No explanation outside the JSON.

TAG — exactly one of "Priority", "Review", "Hold":

"Priority" — strong for their own role: around 3+ years in that role or an adjacent one in the same family, AND either prior US client experience or skills and tools that genuinely match the role, AND a bio in clear professional English.

"Hold" — positive evidence of a poor fit for the role they applied for: stated experience far below what the role needs, OR a bio whose English would not work in a US client-facing role, OR skills and tools that contradict the stated role.

"Review" — everything else, INCLUDING every candidate whose profile is too incomplete to judge.

Never return "Hold" because information is missing. A blank bio, no skills, no tools, or "Not provided" for US experience means the profile is unfinished, not that the person is unqualified — those are "Review", and the reason must name what is missing rather than describe the candidate as weak.

Judging a role as unsuitable because it is not legal or accounting work is always wrong. Every family listed above is a role this marketplace recruits for.

SCORE — 1 to 10, how strong this candidate is FOR THEIR OWN ROLE. 10 is outstanding for that role. Score the evidence actually present; where the profile is too thin to tell, return 5 and say so in the reason rather than scoring low for the gap.

REASON — one sentence, describing this candidate specifically. If the profile is incomplete, say which fields are missing.

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

  // Reclaim rows stranded by a killed invocation. The claim below is the only
  // writer of 'processing' and nothing ever read it back — a run ended by
  // maxDuration, a deploy, or a crash left its in-flight row here forever: not
  // matched by the work query, not by the bulk reset, not by the permanent
  // failure alert. The candidate was silently dropped. The window is well
  // above maxDuration so a legitimately running claim is never stolen.
  const STRANDED_AFTER_MS = 10 * 60 * 1000;
  await supabase
    .from("screening_queue")
    .update({
      status: "pending",
      claimed_at: null,
      error_text: "reclaimed: stranded in processing",
    })
    .eq("status", "processing")
    .lt("claimed_at", new Date(now.getTime() - STRANDED_AFTER_MS).toISOString());

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
    // Claim the item. The status predicate is the optimistic lock, but its
    // result was discarded, so a run that lost the claim still fell through
    // and screened the candidate again — duplicate model calls and duplicate
    // side effects whenever two cron invocations overlapped.
    const { data: claimed } = await supabase
      .from("screening_queue")
      .update({ status: "processing", claimed_at: new Date().toISOString() })
      .eq("id", item.id)
      .in("status", ["pending", "rate_limited"])
      .select("id");

    if (!claimed || claimed.length === 0) {
      continue;
    }

    // Fetch candidate data
    const { data: candidate } = await supabase
      .from("candidates")
      .select("full_name, email, country, role_category, years_experience, hourly_rate, bio, us_client_experience, skills, tools, application_stage")
      .eq("id", item.candidate_id)
      .single();

    // Never screen a record the candidate has not filled in yet. Stage 1
    // writes placeholders (years_experience "0-1", hourly_rate 5, no bio), and
    // screening those tagged 85% of everyone "Hold" at an average 1.02/5 — the
    // model was accurately describing an empty form. Enqueueing now happens at
    // the end of stage 2; this is the backstop for any other enqueue path.
    // Released back to pending rather than failed: the data is coming, it is
    // just not here yet.
    if (candidate && (candidate.application_stage ?? 0) < 2) {
      await supabase
        .from("screening_queue")
        .update({
          status: "pending",
          claimed_at: null,
          error_text: "deferred: application not yet submitted",
        })
        .eq("id", item.id);
      continue;
    }

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
    // `/hrnth` was a typo for `/hr` and went to the model on every call for
    // months. Also: the field is documented per-hour but is a cycle amount on
    // some rows, so it is labelled rather than asserted.
    const role = candidate.role_category as string | null;
    const expected = role ? SKILLS_BY_ROLE[role] : undefined;

    const candidateSummary = JSON.stringify({
      name: candidate.full_name,
      country: candidate.country,
      role: role ?? "Not provided",
      role_family: groupForRole(role) ?? "Not recognised",
      // So "do their skills match the role?" is a question the model can
      // actually answer, instead of one it has to guess the answer to.
      skills_typical_for_this_role: expected ?? "unknown for this role",
      experience: candidate.years_experience || "Not provided",
      stated_rate: candidate.hourly_rate ? `$${candidate.hourly_rate}` : "Not provided",
      bio: candidate.bio || "Not provided",
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
      const content = extractText(data);

      // Parse JSON response
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        throw new Error(`Invalid JSON response: ${content.slice(0, 200)}`);
      }

      const screening = JSON.parse(jsonMatch[0]);
      // Every reader of this column — the triage board, the candidate filter,
      // the recruiter queue, the reports breakdown — switches on exactly these
      // three strings and renders nothing for anything else. An unrecognised
      // tag was written straight through and became an invisible candidate.
      const raw = typeof screening.tag === "string" ? screening.tag.trim() : "";
      const tag = (["Priority", "Review", "Hold"] as const).find(
        (t) => t.toLowerCase() === raw.toLowerCase()
      ) ?? "Review";
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
    .is("alerted_at", null)
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
    await sendEmail({
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
    }, { recipientKind: "staff", emailType: "screening_queue_failures" });

    // Mark as alerted.
    //
    // NOT by stamping processed_at, which this used to do. That column is the
    // answer to "when was this candidate screened", and writing it on rows
    // that were never screened made a permanently failed screening
    // indistinguishable from a successful one — including to the staleness
    // check that decides whether a tag still describes the record.
    for (const f of failures) {
      await supabase
        .from("screening_queue")
        .update({ alerted_at: new Date().toISOString() })
        .eq("id", f.id);
    }
  } catch { /* silent */ }
}
