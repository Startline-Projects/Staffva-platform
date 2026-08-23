import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hasCronSecret } from "@/lib/auth";

/**
 * GET /api/cron/alert-health
 *
 * Reads the failure signals that nothing was reading.
 *
 * vendor_failures and email_outbox both recorded problems faithfully and had
 * zero readers — no admin page, no alert, nothing. A signal nobody looks at is
 * the same as no signal, which is how a retired Anthropic model broke every
 * interview for ten weeks without anyone noticing.
 *
 * On the bootstrap problem: this route is gated on CRON_SECRET like every other
 * non-public route, so it cannot report its own missing secret. That is not
 * solved by exempting it — an unauthenticated endpoint that posts to Slack is a
 * worse trade. Instead it returns a non-2xx whenever something is wrong, and a
 * 401 when unconfigured, so BOTH states show up red in Vercel's cron dashboard.
 * The status code says which: 401 means nobody set the secret, 503 means the
 * secret is fine and something else is broken.
 */

export const dynamic = "force-dynamic";

// Do not re-alert an unresolved problem every 15 minutes; people mute channels
// that do that, which is a slower path back to having no signal at all.
const REALERT_AFTER_MS = 60 * 60 * 1000;

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type Check = {
  key: string;
  severity: "critical" | "warning";
  count: number;
  message: string;
};

async function postToSlack(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Never let the alerter throw. The non-2xx return below is the backstop
    // signal, and it does not depend on Slack being reachable.
    console.error("[alert-health] Slack post failed:", err);
  }
}

export async function GET(request: NextRequest) {
  if (!hasCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getAdminClient();
  const now = Date.now();
  const since = (ms: number) => new Date(now - ms).toISOString();
  const checks: Check[] = [];

  const head = { count: "exact" as const, head: true };

  // A configuration fault every request will hit — a retired model, a revoked
  // key. This is the exact class that went undetected for ten weeks.
  const { count: fatalVendor } = await supabase
    .from("vendor_failures")
    .select("*", head)
    .eq("fatal", true)
    .gte("occurred_at", since(60 * 60 * 1000));

  if (fatalVendor) {
    checks.push({
      key: "vendor_fatal",
      severity: "critical",
      count: fatalVendor,
      message: `${fatalVendor} fatal vendor failure(s) in the last hour — a key or model id is wrong, and every request is hitting it.`,
    });
  }

  // Each of these is a person who signed up and can never log in.
  const { count: failedEmails } = await supabase
    .from("email_outbox")
    .select("*", head)
    .eq("status", "failed")
    .gte("created_at", since(24 * 60 * 60 * 1000));

  if (failedEmails) {
    checks.push({
      key: "email_failed",
      severity: "critical",
      count: failedEmails,
      message: `${failedEmails} email(s) gave up after all retries in the last 24h. Any verification email here is a candidate who cannot log in.`,
    });
  }

  // The drain is not running. Most likely CRON_SECRET, a failing deploy, or the
  // cron being disabled — all of which stop signup dead without any other sign.
  const { count: staleQueued } = await supabase
    .from("email_outbox")
    .select("*", head)
    .eq("status", "pending")
    .lt("created_at", since(15 * 60 * 1000));

  if (staleQueued) {
    checks.push({
      key: "email_backlog",
      severity: "critical",
      count: staleQueued,
      message: `${staleQueued} email(s) queued over 15 minutes ago and still unsent — the outbox drain is not keeping up or is not running.`,
    });
  }

  // Finished the application, but nothing was ever queued to screen them. The
  // stale-queue check below cannot see these — it looks for rows that are
  // waiting, and the whole problem here is that no row exists. They have no
  // screening_tag either, so no recruiter view lists them. Without this they are
  // invisible in every direction at once.
  const { data: unqueued } = await supabase.rpc("count_unqueued_stage2_candidates", {
    p_older_than_minutes: 30,
  });

  if (unqueued) {
    checks.push({
      key: "screening_never_queued",
      severity: "critical",
      count: unqueued as number,
      message: `${unqueued} candidate(s) completed their application over 30 minutes ago but were never queued for screening — they are not waiting in the queue, they are absent from it, and no recruiter will ever see them.`,
    });
  }

  const { count: staleScreening } = await supabase
    .from("screening_queue")
    .select("*", head)
    .eq("status", "pending")
    .lt("created_at", since(60 * 60 * 1000));

  if (staleScreening) {
    checks.push({
      key: "screening_backlog",
      severity: "warning",
      count: staleScreening,
      message: `${staleScreening} candidate(s) waiting over an hour for AI screening.`,
    });
  }

  // Completed interviews with no score: the candidate sees a results page that
  // never resolves, and the rescue sweep is meant to catch this.
  const { count: unscored } = await supabase
    .from("ai_interviews")
    .select("*", head)
    .eq("status", "completed")
    .is("overall_score", null)
    .lt("completed_at", since(30 * 60 * 1000));

  if (unscored) {
    checks.push({
      key: "interviews_unscored",
      severity: "warning",
      count: unscored,
      message: `${unscored} interview(s) completed over 30 minutes ago with no score — the scoring sweep is not recovering them.`,
    });
  }

  // Interviews parked because their transcript was mostly silence. The scoring
  // route deliberately refuses to score these rather than reject a candidate
  // for audio that failed on our side — but a parked interview gets no score,
  // no email and no sweep, so without this it is invisible and the candidate
  // waits forever. Refusing to auto-reject is only an improvement if somebody
  // then looks.
  const { count: parked } = await supabase
    .from("ai_interviews")
    .select("*", head)
    .eq("status", "failed_technical")
    .gte("created_at", since(7 * 24 * 60 * 60 * 1000));

  if (parked) {
    checks.push({
      key: "interviews_parked",
      severity: "warning",
      count: parked,
      message: `${parked} interview(s) parked for review in the last 7 days — the candidate could not be heard, so they were not scored. Each needs a human decision or a re-invite.`,
    });
  }

  // Decide what is worth saying out loud.
  const { data: priorState } = await supabase.from("alert_state").select("*");
  const prior = new Map((priorState ?? []).map((s) => [s.check_key, s]));

  const toAnnounce = checks.filter((c) => {
    const last = prior.get(c.key);
    if (!last) return true;
    const stale = now - new Date(last.last_alerted_at).getTime() > REALERT_AFTER_MS;
    // Speak up early if a problem is growing fast, even inside the quiet period.
    const worsened = c.count >= last.last_count * 2 && c.count > last.last_count;
    return stale || worsened;
  });

  if (toAnnounce.length > 0) {
    const site = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";
    const lines = toAnnounce.map(
      (c) => `${c.severity === "critical" ? "🔴" : "🟡"} *${c.key}* — ${c.message}`
    );
    await postToSlack(`*StaffVA health*\n${lines.join("\n")}\n<${site}/admin|Open admin>`);

    await supabase.from("alert_state").upsert(
      toAnnounce.map((c) => ({
        check_key: c.key,
        last_alerted_at: new Date(now).toISOString(),
        last_count: c.count,
      })),
      { onConflict: "check_key" }
    );
  }

  // Clear the memory of anything that has recovered, so its next occurrence
  // alerts immediately rather than waiting out a stale quiet period.
  const activeKeys = checks.map((c) => c.key);
  const resolved = [...prior.keys()].filter((k) => !activeKeys.includes(k));
  if (resolved.length > 0) {
    await supabase.from("alert_state").delete().in("check_key", resolved);
  }

  const critical = checks.some((c) => c.severity === "critical");

  // Non-2xx so a problem is visible as a failing cron in Vercel even if Slack
  // is unconfigured or unreachable.
  return NextResponse.json(
    { healthy: checks.length === 0, checks, announced: toAnnounce.length, resolved },
    { status: critical ? 503 : 200 }
  );
}
