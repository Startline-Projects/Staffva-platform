import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateInterviewToken } from "@/lib/interviewToken";
import { applicationClosed } from "@/lib/reviewOutcome";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: candidate, error } = await supabase
    .from("candidates")
    .select("id, admin_status, permanently_blocked, reapply_eligible_at")
    .eq("user_id", user.id)
    .single();

  if (error || !candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  // A decided application does not get to spend more money.
  //
  // This route selected `id` and nothing else — no status, no block, no retake
  // check — so a candidate who had just been declined could start another
  // proctored AI interview and burn ElevenLabs and Anthropic spend on a funnel
  // with a fixed outcome. The English route has gated on permanently_blocked
  // since it shipped; the interview mint was the one that did not.
  if (applicationClosed(candidate)) {
    return NextResponse.json(
      {
        error: "This application is closed.",
        applicationClosed: true,
        reapplyEligibleAt: candidate.reapply_eligible_at ?? null,
      },
      { status: 403 }
    );
  }

  const token = await generateInterviewToken(candidate.id);
  return NextResponse.json({ token });
}
