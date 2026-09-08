import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { maskCandidateText } from "@/lib/contactMask";
import { scoreCandidateForJob, type MatchCandidate, type MatchJob } from "@/lib/jobMatch";
import { computeVisibility } from "@/lib/candidateVisibility";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything the scorer reads plus everything the card shows. */
const CANDIDATE_FIELDS =
  "id, display_name, country, role_category, hourly_rate, english_written_tier, us_client_experience, " +
  "availability_status, availability_date, profile_photo_url, skills, tools, ai_interview_passed, " +
  // Visibility columns: a match row is the invite route's ONLY authorization,
  // so a candidate blocked or unlisted since publish could still be emailed.
  "admin_status, permanently_blocked, id_verification_status, id_verification_due_at, " +
  "lock_status, availability_last_updated_at, created_at";

/**
 * The match-results read (client step 9).
 *
 * Two decisions worth stating.
 *
 * 1. The SET of matches is what was stored at publish — it is the only
 *    authorization the invite route accepts, so it must not move under the
 *    client's feet. But the SCORE and its per-criterion breakdown are
 *    recomputed here, live, from the candidate's current row. A stored score
 *    is a number that was true once: a candidate who has since raised their
 *    rate above the budget, gone unavailable, or passed the skills interview
 *    would otherwise be described by a figure from the day of the post, with
 *    an evidence list beside it saying something else. Recomputing both from
 *    one function is what keeps the number and its explanation in agreement.
 *
 * 2. The pipeline status is about THE PAIR, not this job. engagement_offers,
 *    interview_bookings and messages carry no job_post_id, so "Offer sent"
 *    here means you have an open offer with this person — possibly for
 *    another role. The UI says so. Atlas conflates the two and asserts things
 *    like "already accepted on a separate engagement" as if it had checked.
 */

type Pipeline = "passed" | "accepted" | "offer" | "interviewing" | "contacted" | "new";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobPostId = searchParams.get("id");
  if (!jobPostId || !UUID.test(jobPostId)) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = admin();
  const { data: client, error: clientErr } = await db
    .from("clients").select("id").eq("user_id", user.id).maybeSingle();
  // A failed lookup is a 500, not "Not a client account" — a transport error
  // must never be reported as a definitive negative about the person.
  if (clientErr) {
    return NextResponse.json({ error: "Could not load the shortlist." }, { status: 500 });
  }
  if (!client) return NextResponse.json({ error: "Not a client account" }, { status: 403 });

  const { data: jobPost, error: postErr } = await db
    .from("job_posts")
    .select(
      "id, client_id, title, summary, role_category, must_have_skills, nice_to_have_skills, " +
      "rate_type, hourly_rate_min, hourly_rate_max, fixed_budget, duration_type, duration_estimate, " +
      "experience_level, hours_per_week_estimate, hours_per_week, budget_range, start_date, " +
      "description, status, published_at, created_at"
    )
    .eq("id", jobPostId)
    .eq("client_id", client.id)
    .maybeSingle();
  if (postErr) {
    return NextResponse.json({ error: "Could not load the role." }, { status: 500 });
  }
  if (!jobPost) return NextResponse.json({ error: "Role not found" }, { status: 404 });

  const { data: matchRows, error: matchErr } = await db
    .from("job_post_matches")
    .select(`candidate_id, match_score, invited_at, passed_at, candidates(${CANDIDATE_FIELDS})`)
    .eq("job_post_id", jobPostId);
  if (matchErr) {
    return NextResponse.json({ error: "Could not load the shortlist." }, { status: 500 });
  }

  const rows = (matchRows ?? []).filter((m) => m.candidates);
  const candidateIds = rows.map((r) => r.candidate_id as string);

  // Pipeline signals. `signalsOk` is false if ANY of them failed — the page
  // then says the stages are unavailable rather than showing everyone as
  // "New", which would send a client to re-contact people they already have
  // an offer out to. Swallowing these is exactly the pattern this codebase
  // has been unwinding.
  const contacted = new Set<string>();
  const interviewing = new Set<string>();
  const offered = new Set<string>();
  const accepted = new Set<string>();
  let signalsOk = true;
  if (candidateIds.length > 0) {
    // Messages are one row per message, so an `.in()` with a limit can page
    // right past a quiet thread — a client with 1,200 messages to one person
    // would lose the signal for everyone else. A HEAD count per candidate is
    // exact, and the match set is capped at 12 by the publish path.
    const msgCounts = Promise.all(
      candidateIds.map((cid) =>
        db.from("messages").select("id", { count: "exact", head: true })
          .eq("client_id", client.id).eq("candidate_id", cid)
          .then((r) => ({ cid, count: r.count ?? 0, error: r.error }))
      )
    );
    const [counts, ivs, offers] = await Promise.all([
      msgCounts,
      // 'completed' as well as 'booked': uq_booking_pair is a partial unique
      // index on booked, so a finished interview flips to completed and the
      // card would regress from "Interviewing" back to "New".
      db.from("interview_bookings").select("candidate_id")
        .eq("client_id", client.id).in("candidate_id", candidateIds)
        .in("status", ["booked", "completed"]).limit(1000),
      db.from("engagement_offers").select("candidate_id, status")
        .eq("client_id", client.id).in("candidate_id", candidateIds)
        .in("status", ["sent", "viewed", "countered", "accepted"]).limit(1000),
    ]);
    for (const r of counts) {
      if (r.error) {
        console.error("[jobs/shortlist] message signal failed:", r.error.message);
        signalsOk = false;
      } else if (r.count > 0) contacted.add(r.cid);
    }
    if (ivs.error) {
      console.error("[jobs/shortlist] interview signal failed:", ivs.error.message);
      signalsOk = false;
    }
    if (offers.error) {
      console.error("[jobs/shortlist] offer signal failed:", offers.error.message);
      signalsOk = false;
    }
    for (const i of ivs.data || []) interviewing.add(i.candidate_id as string);
    for (const o of offers.data || []) {
      const cid = o.candidate_id as string;
      // An accepted offer is the opposite of an outstanding one.
      if (o.status === "accepted") accepted.add(cid);
      else offered.add(cid);
    }
  }

  const matches = rows.map((m) => {
    const cand = m.candidates as unknown as Record<string, unknown>;
    // Cast because the concatenated select string defeats supabase-js's row
    // inference; the columns are all named in CANDIDATE_FIELDS and the job
    // select above.
    //
    // NOTE the scorer reads the RAW row, before maskCandidateText below. Safe
    // today — the only candidate-authored string reaching an evidence line is
    // role_category — but anyone adding an evidence line that quotes bio or
    // tagline must mask it here first.
    const { score, criteria } = scoreCandidateForJob(
      cand as MatchCandidate,
      jobPost as unknown as MatchJob
    );
    const id = m.candidate_id as string;

    // Same treatment /shortlists gives a withdrawn candidate: say what
    // happened, and stop shipping their directory data to the browser. The
    // page also disables Invite for them — inviting mails the candidate.
    const vis = computeVisibility(cand);
    const withdrawn = cand.permanently_blocked
      ? "This account has been closed."
      : cand.admin_status !== "approved"
        ? "No longer listed on StaffVA."
        : !vis.searchable
          ? "Temporarily hidden from search."
          : null;

    // Most-advanced state wins. Order matters: someone you have interviewed
    // AND messaged is "interviewing", not "contacted".
    const pipeline: Pipeline = m.passed_at
      ? "passed"
      : accepted.has(id)
        ? "accepted"
        : offered.has(id)
          ? "offer"
          : interviewing.has(id)
            ? "interviewing"
            : contacted.has(id) || m.invited_at
              ? "contacted"
              : "new";

    const masked = maskCandidateText(cand) as Record<string, unknown>;
    if (withdrawn) {
      masked.country = "";
      masked.hourly_rate = null;
      masked.profile_photo_url = null;
      masked.role_category = "";
    }

    return {
      ...masked,
      match_score: score,
      criteria: withdrawn ? [] : criteria,
      invited_at: m.invited_at,
      passed_at: m.passed_at,
      pipeline,
      withdrawn,
    };
  });

  matches.sort((a, b) => b.match_score - a.match_score);

  return NextResponse.json({ jobPost, matches, signalsOk });
}

/** Pass / un-pass a match. The one pipeline state nothing else can derive. */
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const jobPostId = typeof body.jobPostId === "string" ? body.jobPostId : "";
  const candidateId = typeof body.candidateId === "string" ? body.candidateId : "";
  // Explicit boolean required. `body.passed === true` alone meant a truncated
  // or malformed body silently UN-passed a candidate instead of erroring.
  if (typeof body.passed !== "boolean") {
    return NextResponse.json({ error: "passed must be true or false" }, { status: 400 });
  }
  const passed: boolean = body.passed;
  if (!UUID.test(jobPostId) || !UUID.test(candidateId)) {
    return NextResponse.json({ error: "jobPostId and candidateId required" }, { status: 400 });
  }

  const db = admin();
  const { data: client, error: clientErr } = await db
    .from("clients").select("id").eq("user_id", user.id).maybeSingle();
  if (clientErr) return NextResponse.json({ error: "Could not save that." }, { status: 500 });
  if (!client) return NextResponse.json({ error: "Not a client account" }, { status: 403 });

  // Ownership is checked on the JOB POST, then the update is scoped to it —
  // so a guessed job id belonging to another client updates nothing.
  const { data: owned } = await db
    .from("job_posts").select("id").eq("id", jobPostId).eq("client_id", client.id).maybeSingle();
  if (!owned) return NextResponse.json({ error: "Not your role" }, { status: 403 });

  const { data, error } = await db
    .from("job_post_matches")
    .update({ passed_at: passed ? new Date().toISOString() : null })
    .eq("job_post_id", jobPostId)
    .eq("candidate_id", candidateId)
    .select("candidate_id")
    .maybeSingle();
  if (error) {
    console.error("[jobs/shortlist] pass failed:", error.message);
    return NextResponse.json({ error: "Could not save that." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Not shortlisted for this role" }, { status: 404 });

  return NextResponse.json({ candidateId, passed });
}
