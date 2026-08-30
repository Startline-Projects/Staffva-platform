import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { extractText } from "@/lib/anthropic";
import { enforceRateLimit, clientIp, LIMITS } from "@/lib/rateLimit";
import {
  buildSystemPrompt,
  buildUserPrompt,
  getRateStats,
  validateDraft,
} from "@/lib/jobDraft";

export const maxDuration = 60;

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const MAX_BRIEF_CHARS = 2000;
const MAX_INSTRUCTION_CHARS = 300;
const MAX_DRAFT_JSON_CHARS = 8000;

/**
 * POST /api/jobs/draft — turn a client's plain-words brief into a structured
 * job post, or revise an existing draft on instruction.
 *
 * Anonymous on purpose: drafting is the front door of the demand funnel and
 * the platform has never had a client send a single message — the last thing
 * this flow needs is a signup wall before the first moment of value. The cost
 * exposure is bounded the same way /api/match was hardened: IP-keyed rate
 * limit, hard input caps, and one bounded retry.
 *
 * Everything the model returns passes through validateDraft, which clamps,
 * checks the role against the taxonomy, and strips markup — the model
 * proposes, the server disposes.
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Drafting is temporarily unavailable." },
      { status: 503 }
    );
  }

  const limited = await enforceRateLimit(`jobdraft:ip:${clientIp(req)}`, LIMITS.jobDraft);
  if (limited) return limited;

  let body: { brief?: unknown; currentDraft?: unknown; instruction?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  if (brief.length < 10) {
    return NextResponse.json(
      { error: "Tell us a little more about what you need — a sentence or two is plenty." },
      { status: 400 }
    );
  }
  if (brief.length > MAX_BRIEF_CHARS) {
    return NextResponse.json(
      { error: `Please keep the brief under ${MAX_BRIEF_CHARS} characters.` },
      { status: 400 }
    );
  }

  const instruction =
    typeof body.instruction === "string" && body.instruction.trim()
      ? body.instruction.trim().slice(0, MAX_INSTRUCTION_CHARS)
      : null;
  let currentDraft: unknown = null;
  if (instruction && body.currentDraft && typeof body.currentDraft === "object") {
    const asJson = JSON.stringify(body.currentDraft);
    if (asJson.length <= MAX_DRAFT_JSON_CHARS) currentDraft = body.currentDraft;
  }

  const rateStats = await getRateStats(getAdminClient());
  const system = buildSystemPrompt(rateStats);
  const user = buildUserPrompt(brief, currentDraft, instruction);

  // One call plus one bounded retry on an unparseable completion — the same
  // shape the interview scorer uses. Thinking is explicitly disabled: with it
  // on, thinking blocks can lead content and max_tokens covers them too.
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45_000);
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2000,
          thinking: { type: "disabled" },
          system,
          messages: [{ role: "user", content: user }],
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
    } catch {
      return NextResponse.json(
        { error: "Drafting took too long. Please try again." },
        { status: 504 }
      );
    }

    if (!response.ok) {
      const status = response.status === 429 ? 503 : 502;
      return NextResponse.json(
        { error: "Drafting is temporarily unavailable. Please try again in a minute." },
        { status }
      );
    }

    const data = await response.json();
    const text = extractText(data);
    const result = validateDraft(text);

    if (result.ok) {
      return NextResponse.json({ draft: result.draft });
    }
    if ("refusal" in result) {
      return NextResponse.json({ refusal: result.refusal }, { status: 200 });
    }
    // invalid — loop once more, then give up honestly
    if (attempt === 1) {
      console.error("[jobs/draft] unusable completion twice:", result.invalid);
      return NextResponse.json(
        { error: "We could not draft that just now. Please try again." },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({ error: "Unreachable" }, { status: 500 });
}
