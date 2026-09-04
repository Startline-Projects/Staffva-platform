import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { recordStatusEvent } from "@/lib/reviewOutcome";

/**
 * One appeal per rejection, in the candidate's own words.
 *
 * Everything runs under the service role because the appeal columns carry no
 * `authenticated` grant — public.candidates grants UPDATE column by column, and
 * omitting these is the lock. A candidate must not be able to write their own
 * appeal state, clear their own decision, or submit a second appeal by
 * replaying the request.
 *
 * Atlas promises this goes to "a different Talent Specialist" within "5
 * business days". Neither is promised here: there are two admin accounts and
 * one is a test rig, and no turnaround has ever been met. What the candidate
 * is told is what happens — a person reads it and answers in writing.
 */

const MAX_APPEAL_CHARS = 1500;
const MIN_APPEAL_CHARS = 40;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const text = typeof (body as { text?: unknown }).text === "string"
    ? (body as { text: string }).text.trim()
    : "";

  if (text.length < MIN_APPEAL_CHARS) {
    return NextResponse.json(
      { error: `Tell us what you think we got wrong — at least ${MIN_APPEAL_CHARS} characters.` },
      { status: 400 }
    );
  }
  if (text.length > MAX_APPEAL_CHARS) {
    return NextResponse.json(
      { error: `Please keep this under ${MAX_APPEAL_CHARS} characters.` },
      { status: 400 }
    );
  }

  const db = admin();
  const { data: candidate } = await db
    .from("candidates")
    .select("id, admin_status, permanently_blocked, appeal_submitted_at, rejected_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!candidate) {
    return NextResponse.json({ error: "No candidate profile" }, { status: 404 });
  }
  if (candidate.admin_status !== "rejected" || !candidate.rejected_at) {
    return NextResponse.json(
      { error: "There is no decision to appeal." },
      { status: 409 }
    );
  }
  // A fraud ban is not an application decision and does not take an appeal
  // through this door.
  if (candidate.permanently_blocked) {
    return NextResponse.json(
      { error: "This account is closed. Contact support." },
      { status: 409 }
    );
  }
  if (candidate.appeal_submitted_at) {
    return NextResponse.json(
      { error: "You have already appealed this decision." },
      { status: 409 }
    );
  }

  // Conditional on the appeal still being unset, so a double submit cannot
  // overwrite the first one.
  const { data: written, error } = await db
    .from("candidates")
    .update({ appeal_text: text, appeal_submitted_at: new Date().toISOString() })
    .eq("id", candidate.id)
    .is("appeal_submitted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[appeal] write failed:", error.message);
    return NextResponse.json({ error: "We couldn't record your appeal." }, { status: 500 });
  }
  if (!written) {
    return NextResponse.json(
      { error: "You have already appealed this decision." },
      { status: 409 }
    );
  }

  await recordStatusEvent({
    candidateId: candidate.id,
    from: "rejected",
    to: "rejected",
    actorId: user.id,
    actorRole: "candidate",
    reason: "appeal submitted",
  });

  return NextResponse.json({ ok: true });
}
