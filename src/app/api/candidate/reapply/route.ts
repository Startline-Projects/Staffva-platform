import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { mayReapply, recordStatusEvent } from "@/lib/reviewOutcome";

/**
 * Re-open a declined application once the hold has expired.
 *
 * This is the only route that moves a candidate out of `rejected` without a
 * staff action, and it is a timestamp comparison — so the hold expires itself.
 * That is the whole reason the hold is a date rather than a flag:
 * permanently_blocked has told people "you may reapply in 90 days" since it
 * shipped, with no expiry and no cron behind it, and that has never once been
 * true.
 *
 * Worth stating plainly, because the copy must not overreach: this binds an
 * ACCOUNT. Nothing in this platform identifies a person at signup —
 * verified_identities is empty and no profile has a verified phone — so a
 * second email address walks straight back into the funnel. The candidate is
 * told "you can apply again on <date>", which is true of their account, and
 * never "one application per person", which is not true of anything.
 */

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = admin();
  const { data: candidate } = await db
    .from("candidates")
    .select("id, admin_status, permanently_blocked, reapply_eligible_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!candidate) return NextResponse.json({ error: "No candidate profile" }, { status: 404 });

  if (!mayReapply(candidate)) {
    return NextResponse.json(
      {
        error: candidate.permanently_blocked
          ? "This account is closed."
          : "You can't apply again yet.",
        reapplyEligibleAt: candidate.reapply_eligible_at ?? null,
      },
      { status: 403 }
    );
  }

  // Back to the start of the funnel, carrying the assessments. Only the
  // decision fields are cleared — english_*_score, test_attempts and
  // ai_interviews are untouched, which is what makes "your interviews and
  // tests stay on file" true rather than reassuring.
  const { data: reopened, error } = await db
    .from("candidates")
    .update({
      admin_status: "active",
      rejection_reason: null,
      rejected_at: null,
      rejected_by: null,
      reapply_eligible_at: null,
      appeal_text: null,
      appeal_submitted_at: null,
      appeal_decision: null,
      appeal_decided_at: null,
      appeal_decided_by: null,
      appeal_response: null,
    })
    .eq("id", candidate.id)
    .eq("admin_status", "rejected")
    .lte("reapply_eligible_at", new Date().toISOString())
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[reapply] failed:", error.message);
    return NextResponse.json({ error: "We couldn't reopen your application." }, { status: 500 });
  }
  if (!reopened) {
    return NextResponse.json({ error: "You can't apply again yet." }, { status: 403 });
  }

  await recordStatusEvent({
    candidateId: candidate.id,
    from: "rejected",
    to: "active",
    actorId: user.id,
    actorRole: "candidate",
    reason: "hold expired, candidate reapplied",
  });

  return NextResponse.json({ ok: true });
}
