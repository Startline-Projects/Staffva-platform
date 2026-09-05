// src/app/api/jobs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { validateDraft, type JobDraft } from "@/lib/jobDraft";
import { containsContact, maskCandidateText } from "@/lib/contactMask";
import { hasUsExperience } from "@/lib/usExperienceLabels";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// The maximum the structured scorer can award: 40 role + 24 must-have +
// 9 nice-to-have + 15 rate + 8 english + 5 US + 4 availability.
const MAX_MATCH_SCORE = 105;

/** The columns the shortlist scores over. */
interface PoolCandidate {
  id: string;
  role_category: string | null;
  hourly_rate: number | null;
  english_written_tier: string | null;
  us_client_experience: string | null;
  availability_status: string | null;
  skills: unknown;
  tools: unknown;
  bio?: string | null;
  tagline?: string | null;
  [k: string]: unknown;
}

// POST — Create a job post and return matched candidates
export async function POST(req: NextRequest) {
  try {
    const supabase = getAdminClient();

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ).auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await req.json();

    // ── Structured branch: the AI composer publishes here ──
    //
    // The draft arrives client-shaped but is NEVER trusted: it goes back
    // through validateDraft — the same clamps the model's own output passes —
    // so a hand-crafted request can publish nothing a legitimate draft could
    // not. Legacy compat fields are derived so the existing shortlist and
    // invite email keep working unchanged.
    if (body.draft && typeof body.draft === "object") {
      const checked = validateDraft(JSON.stringify(body.draft));
      if (!checked.ok) {
        return NextResponse.json(
          { error: "refusal" in checked ? checked.refusal : "Invalid job draft" },
          { status: 400 }
        );
      }
      const d: JobDraft = checked.draft;
      const startDate = ["Immediately", "Within 2 weeks", "Within a month"].includes(body.start_date)
        ? (body.start_date as string)
        : "Immediately";
      const brief = typeof body.brief === "string" ? body.brief.slice(0, 2000) : null;

      // Job posts reach every matched candidate — the same pre-hire rule as
      // messages applies: no contact details in the text. The client's raw
      // brief to the composer is deliberately NOT checked: it is never shown
      // to candidates, and "I run acme-shop.com, need a Shopify VA" is the
      // normal way to use a composer.
      // Every field jobs_for_candidate() hands to a candidate goes through this,
      // not just the prose ones. Skill tags and duration_estimate are rendered
      // on the role card too, and a chip reading "call 555-0100" is a contact
      // detail wherever it is displayed.
      const freeText = [
        d.title,
        d.summary,
        ...(d.responsibilities || []),
        ...(d.must_have_skills || []),
        ...(d.nice_to_have_skills || []),
        d.duration_estimate,
        d.hours_per_week_estimate,
      ]
        .filter(Boolean)
        .join("\n");
      if (containsContact(freeText)) {
        return NextResponse.json(
          {
            error:
              "Job posts can't include contact details — candidates apply and message you here on StaffVA, which keeps both sides protected.",
          },
          { status: 400 }
        );
      }

      const legacyBudget =
        d.rate_type === "hourly"
          ? `$${d.hourly_rate_min}-$${d.hourly_rate_max}/hr`
          : `$${d.fixed_budget} fixed`;

      const { data: jobPost, error: insertError } = await supabase
        .from("job_posts")
        .insert({
          client_id: client.id,
          role_category: d.role_category,
          title: d.title,
          summary: d.summary,
          responsibilities: d.responsibilities,
          must_have_skills: d.must_have_skills,
          nice_to_have_skills: d.nice_to_have_skills,
          rate_type: d.rate_type,
          hourly_rate_min: d.hourly_rate_min,
          hourly_rate_max: d.hourly_rate_max,
          fixed_budget: d.fixed_budget,
          duration_type: d.duration_type,
          duration_estimate: d.duration_estimate,
          experience_level: d.experience_level,
          hours_per_week_estimate: d.hours_per_week_estimate,
          ai_brief: brief,
          // `description` is NOT written any more. jobDraft clamps summary to
          // 600 and job_posts_description_check caps description at 500, so a
          // 501-600 char summary — well within what the model is asked for and
          // within the editor's own maxLength — failed the whole INSERT and
          // returned the raw Postgres error to the Publish button. The column
          // is nullable and nothing in src/ reads it.
          hours_per_week: d.hours_per_week_estimate,
          budget_range: legacyBudget,
          start_date: startDate,
          status: "active",
          // Deliberately NOT published here. job_is_open() requires
          // published_at, so the post is invisible to candidates until the
          // shortlist has been written. Every error path below used to return
          // after an already-live insert, which left a candidate-visible job
          // post behind while telling the client that publishing had failed.
          published_at: null,
        })
        .select()
        .single();

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }

      // The match pool is gated by THE visibility rule — the SQL function is
      // the single definition of "this candidate may see this job" (role
      // match, or a must-have skill they carry). Shortlisting anyone the rule
      // would hide makes no sense: they could never be invited.
      // One call, and the SAME predicate the candidate's own list uses
      // (00192). This was a pool query with a hand-rolled copy of the
      // approved / ID-window / availability rules — which silently omitted
      // permanently_blocked, unlike /api/match — followed by one RPC round trip
      // PER CANDIDATE. 31 today; unusable at the agreed 10k target.
      const { data: eligible, error: eligibleErr } = await supabase.rpc(
        "candidates_for_job",
        { p_job_id: jobPost.id }
      );
      if (eligibleErr) {
        // The post exists but is unpublished; remove it rather than leave a
        // draft the client cannot see or retry.
        await supabase.from("job_posts").delete().eq("id", jobPost.id);
        return NextResponse.json({ error: eligibleErr.message }, { status: 500 });
      }
      const eligibleIds = (eligible || []).map((r: { candidate_id: string }) => r.candidate_id);

      // Fetched in chunks. supabase-js splices every id into a PostgREST GET
      // querystring, and candidates_for_job has no LIMIT, so a broad role at
      // the agreed 10k-candidate target would build a URL past what the
      // gateway accepts and fail the publish outright.
      const CHUNK = 200;
      let visible: PoolCandidate[] = [];
      for (let i = 0; i < eligibleIds.length; i += CHUNK) {
        const { data: rows, error: poolErr } = await supabase
          .from("candidates")
          .select(
            "id, full_name, display_name, country, role_category, years_experience, hourly_rate, english_written_tier, us_client_experience, availability_status, total_earnings_usd, bio, profile_photo_url, skills, tools"
          )
          .in("id", eligibleIds.slice(i, i + CHUNK));
        if (poolErr) {
          await supabase.from("job_posts").delete().eq("id", jobPost.id);
          return NextResponse.json({ error: poolErr.message }, { status: 500 });
        }
        visible = visible.concat((rows || []) as PoolCandidate[]);
      }

      const norm = (arr: unknown): string[] =>
        Array.isArray(arr) ? arr.map((x) => String(x).toLowerCase()) : [];

      const matches = visible
        .map((c) => {
          let score = 0;
          if (c.role_category?.toLowerCase() === d.role_category.toLowerCase()) score += 40;
          // Must-have scores against SKILLS ONLY, matching
          // job_skill_or_role_match in 00192. The gate and the score have to
          // read the same vocabulary: crediting tools here while the gate
          // ignores them would rank a candidate highly on "Slack" for a
          // bookkeeping role they only reached on role category.
          const candidateSkills = new Set(norm(c.skills));
          let must = 0;
          for (const skill of d.must_have_skills) {
            if (candidateSkills.has(skill.toLowerCase())) must += 8;
          }
          score += Math.min(must, 24);
          // Nice-to-have may still credit tools: it is a tie-breaker, not a
          // qualification, and familiarity with a client's stack is real.
          const candidateSkillsAndTools = new Set([...norm(c.skills), ...norm(c.tools)]);
          let nice = 0;
          for (const skill of d.nice_to_have_skills) {
            if (candidateSkillsAndTools.has(skill.toLowerCase())) nice += 3;
          }
          score += Math.min(nice, 9);
          if (d.rate_type === "hourly" && typeof c.hourly_rate === "number") {
            if (c.hourly_rate <= (d.hourly_rate_max as number)) score += 15;
            else if (c.hourly_rate <= (d.hourly_rate_max as number) * 1.2) score += 8;
          } else {
            score += 8;
          }
          if (c.english_written_tier === "exceptional") score += 8;
          else if (c.english_written_tier === "proficient") score += 5;
          else if (c.english_written_tier === "competent") score += 3;
          // The column is an enum whose "none" value is a truthy string, so
          // every candidate scored this. The helper is already used by four
          // other surfaces, including the badge on this very card — so a
          // candidate could score the bonus and not get the badge.
          if (hasUsExperience(c.us_client_experience as string | null)) score += 5;
          if (c.availability_status === "available_now") score += 4;
          // Raw scores max at 105 and the shortlist renders this as both
          // `width: ${score}%` and "{score}% match" — so a strong match
          // overflowed the bar and told a paying client "105% match".
          const pct = Math.max(0, Math.min(100, Math.round((score / MAX_MATCH_SCORE) * 100)));
          return { ...maskCandidateText(c), match_score: pct };
        })
        .sort((a, b) => b.match_score - a.match_score)
        .slice(0, 12);

      // The structured branch is the only reachable publish path and it never
      // wrote job_post_matches — the single insert lived in the legacy branch
      // below, which no UI can reach. That is why the table has zero rows and
      // why "Invite to Role" has always updated nothing. Error-checked, because
      // a silent failure here is exactly how that went unnoticed.
      if (matches.length > 0) {
        const { error: matchErr } = await supabase
          .from("job_post_matches")
          .upsert(
            matches.map((m) => ({
              job_post_id: jobPost.id,
              candidate_id: m.id as string,
              match_score: m.match_score,
            })),
            { onConflict: "job_post_id,candidate_id" }
          );
        if (matchErr) {
          // Not swallowed. These rows are the ONLY authorization the invite
          // route accepts, so a silent failure here produces a shortlist where
          // every "Invite" returns 404 — and the post stays unpublished, so a
          // candidate would never see it either.
          console.error("[jobs] job_post_matches upsert failed:", matchErr.message);
          await supabase.from("job_posts").delete().eq("id", jobPost.id);
          return NextResponse.json(
            { error: "Could not build the shortlist for this role. Nothing was published." },
            { status: 500 }
          );
        }
      }

      // Everything landed: NOW the post becomes visible to candidates.
      const { error: publishErr } = await supabase
        .from("job_posts")
        .update({ published_at: new Date().toISOString() })
        .eq("id", jobPost.id);
      if (publishErr) {
        await supabase.from("job_posts").delete().eq("id", jobPost.id);
        return NextResponse.json({ error: "Could not publish this role." }, { status: 500 });
      }

      return NextResponse.json({ jobPost, matches });
    }

    // The legacy branch used to live here and has been deleted.
    //
    // It was unreachable: /post-role redirects to /post-a-job, which always
    // posts a structured draft. It never set published_at, so anything it
    // wrote would be invisible to the candidate's list forever. It carried a
    // second scoring rule and a second role-matching heuristic — two publish
    // paths is exactly what produced the two generations of column shape in
    // job_posts. And it held a five-candidate near-miss mail blast to
    // candidates, which the freeze suppresses today but which should not be
    // sitting there waiting for the freeze to lift.
    return NextResponse.json(
      { error: "Job posts must be created through the composer." },
      { status: 400 }
    );
  } catch (err) {
    console.error("Job post error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET — List client's job posts
export async function GET(req: NextRequest) {
  try {
    const supabase = getAdminClient();

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
    } = await createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ).auth.getUser(token);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const { data: jobPosts } = await supabase
      .from("job_posts")
      .select("*")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false });

    return NextResponse.json({ jobPosts: jobPosts || [] });
  } catch (err) {
    console.error("Job posts fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
