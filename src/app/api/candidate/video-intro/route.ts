import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * POST /api/candidate/video-intro
 * Body: { videoUrl }
 * Records the uploaded video URL and sets status to pending_review
 */
/**
 * POST is CLOSED.
 *
 * It published any client-supplied URL as the candidate's video intro: it never
 * spent a take, never enforced the minimum length, never checked the prompts
 * were followed, and never verified the file was one we had actually received.
 * With the prompted recorder live, it is a bypass of every rule that recorder
 * exists to apply.
 *
 * Recording now goes through /api/candidate/video-intro/chunk and .../finalize,
 * which counts the take against a file already durably stored.
 *
 * A 410 rather than a deletion so a cached client that still posts here gets a
 * clear answer instead of a 404 that reads like an outage.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Video introductions are now recorded in the browser. Reload the page to record yours.",
    },
    { status: 410 }
  );
}

export async function GET() {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const admin = getAdminClient();

    const { data: candidate } = await admin
      .from("candidates")
      .select("video_intro_url, video_intro_status, video_intro_admin_note, video_intro_submitted_at, video_intro_reviewed_at, video_intro_takes_used, video_intro_takes_allowed, video_intro_duration_ms")
      .eq("user_id", user.id)
      .single();

    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    return NextResponse.json({
      ...candidate,
      // Derived server-side so the recorder cannot be told it has takes it
      // does not. An admin asking for a re-record resets takes_used to 0.
      takes_remaining: Math.max(
        0,
        (candidate.video_intro_takes_allowed ?? 2) - (candidate.video_intro_takes_used ?? 0)
      ),
    });
  } catch (error) {
    console.error("Video intro get error:", error);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}
