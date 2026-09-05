/**
 * Seed one structured, published job post — and its shortlist.
 *
 * This exists because there is currently NO way to create a job post at all.
 * The only reachable path is the AI composer at /post-a-job, and
 * /api/jobs/draft returns 502/503 on any Anthropic failure with no manual-entry
 * fallback. Anthropic is out of credit, so step 14's role list cannot be
 * exercised even once without this.
 *
 * It writes through the service role, exactly as the composer does, and uses
 * the same predicate the product uses (candidates_for_job) to build the
 * shortlist — so what it produces is a real row, not a fixture shaped to make
 * the page look good.
 *
 * Usage:
 *   npx tsx scripts/seed-job-post.ts            # create
 *   npx tsx scripts/seed-job-post.ts --cleanup  # remove what this script made
 */
import { createClient } from "@supabase/supabase-js";

const MARKER = "[seed] ";

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return createClient(url, key);
}

async function cleanup() {
  const supabase = db();
  const { data: posts } = await supabase
    .from("job_posts")
    .select("id, title")
    .like("title", `${MARKER}%`);
  const ids = (posts || []).map((p) => p.id);
  if (ids.length === 0) {
    console.log("nothing to clean up");
    return;
  }
  await supabase.from("job_post_matches").delete().in("job_post_id", ids);
  await supabase.from("job_posts").delete().in("id", ids);
  console.log(`removed ${ids.length} seeded post(s) and their matches`);
}

async function seed() {
  const supabase = db();

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, company_name")
    .limit(1)
    .maybeSingle();
  if (clientErr) throw new Error(`client lookup failed: ${clientErr.message}`);
  if (!client) throw new Error("no clients exist to attribute a post to");

  // Role and skills chosen to match real candidates rather than to look good:
  // the point of the seed is to exercise job_skill_or_role_match against the
  // live bench, so a post nobody matches would prove nothing.
  const { data: sample } = await supabase
    .from("matchable_candidates")
    .select("role_category, skills")
    .limit(50);
  const roles = new Map<string, number>();
  for (const c of sample || []) {
    const r = (c.role_category as string | null)?.trim();
    if (r) roles.set(r, (roles.get(r) ?? 0) + 1);
  }
  const topRole = [...roles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!topRole) throw new Error("no matchable candidates to build a realistic post against");

  const { data: post, error } = await supabase
    .from("job_posts")
    .insert({
      client_id: client.id,
      role_category: topRole,
      title: `${MARKER}${topRole} — 20 hrs/week`,
      summary:
        "Support a small team with day-to-day coordination and follow-up. " +
        "You will own your own queue and check in once a week.",
      responsibilities: [
        "Keep the shared inbox triaged and answered within one working day",
        "Prepare a short weekly summary of what moved and what is stuck",
        "Keep the CRM current after every client conversation",
      ],
      must_have_skills: ["Email management", "Calendar management"],
      nice_to_have_skills: ["CRM"],
      rate_type: "hourly",
      hourly_rate_min: 8,
      hourly_rate_max: 14,
      duration_type: "ongoing",
      duration_estimate: "3+ months",
      experience_level: "mid",
      hours_per_week_estimate: "20 hrs/week",
      // Deliberately NOT "Immediately": job_start_ok() narrows those to
      // available_now candidates only, and the point of the seed is to
      // exercise the normal path.
      start_date: "Within 2 weeks",
      status: "active",
      published_at: new Date().toISOString(),
    })
    .select("id, title")
    .single();
  if (error) throw new Error(`insert failed: ${error.message}`);

  // Shortlist through the product's own predicate.
  const { data: eligible, error: eligErr } = await supabase.rpc("candidates_for_job", {
    p_job_id: post.id,
  });
  if (eligErr) throw new Error(`candidates_for_job failed: ${eligErr.message}`);

  const ids = (eligible || []).map((r: { candidate_id: string }) => r.candidate_id).slice(0, 12);
  if (ids.length > 0) {
    const { error: mErr } = await supabase.from("job_post_matches").upsert(
      ids.map((candidate_id: string, i: number) => ({
        job_post_id: post.id,
        candidate_id,
        match_score: 90 - i * 2,
      })),
      { onConflict: "job_post_id,candidate_id" }
    );
    if (mErr) throw new Error(`match upsert failed: ${mErr.message}`);
  }

  console.log(`created ${post.title}`);
  console.log(`  id:          ${post.id}`);
  console.log(`  role:        ${topRole}`);
  console.log(`  shortlisted: ${ids.length} candidate(s)`);
  console.log(`\nremove it again with: npx tsx scripts/seed-job-post.ts --cleanup`);
}

const main = process.argv.includes("--cleanup") ? cleanup : seed;
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
