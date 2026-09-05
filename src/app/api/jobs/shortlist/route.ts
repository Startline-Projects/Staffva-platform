import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { maskCandidateText } from "@/lib/contactMask";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Keep in step with the publish path's MAX_MATCH_SCORE normalization — the
// stored match_score is already the 0-100 percentage it computed.
const CANDIDATE_FIELDS =
  "id, display_name, country, role_category, hourly_rate, english_written_tier, us_client_experience, availability_status, total_earnings_usd, bio, profile_photo_url";

/**
 * Reloads a shortlist from the database — the fix for the step-18 finding
 * "a client's shortlist and invite ability evaporate with the browser
 * session". The matches were persisted at publish all along (they are the
 * ONLY authorization the invite route accepts); nothing ever read them back.
 * Owner-scoped: the job post must belong to the calling client.
 *
 * Candidates are masked with the SAME helper the publish response used —
 * this is a client-facing surface, and free-text candidate fields must not
 * become a contact channel on the reload that skipped the mask.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobPostId = searchParams.get("id");
  if (!jobPostId || !/^[0-9a-f-]{36}$/i.test(jobPostId)) {
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
    .select("id, client_id, title, role_category, hours_per_week, budget_range, start_date, description, status, published_at")
    .eq("id", jobPostId)
    .eq("client_id", client.id)
    .maybeSingle();
  if (postErr) {
    return NextResponse.json({ error: "Could not load the role." }, { status: 500 });
  }
  if (!jobPost) return NextResponse.json({ error: "Role not found" }, { status: 404 });

  const { data: matchRows, error: matchErr } = await db
    .from("job_post_matches")
    .select(`match_score, invited_at, candidates(${CANDIDATE_FIELDS})`)
    .eq("job_post_id", jobPostId)
    .order("match_score", { ascending: false });
  if (matchErr) {
    return NextResponse.json({ error: "Could not load the shortlist." }, { status: 500 });
  }

  const matches = (matchRows ?? [])
    .filter((m) => m.candidates)
    .map((m) => ({
      ...maskCandidateText(m.candidates as unknown as Record<string, unknown>),
      match_score: m.match_score,
      invited_at: m.invited_at,
    }));

  return NextResponse.json({ jobPost, matches });
}
