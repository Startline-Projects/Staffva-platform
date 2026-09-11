import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { getUser } from "@/lib/auth";
import { assessmentCapabilities } from "@/lib/assessment";
import AssessmentClient from "./AssessmentClient";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export const metadata = { title: "Proctored English Assessment — StaffVA" };

/**
 * Step 8: the Proctored English Assessment on its own Atlas page.
 * The server half decides which mode the page opens in — run the test,
 * show the cooldown, blocked, or already-passed state — and how honest
 * the consent copy must be (spoken parts are vendor-gated).
 */
export default async function AssessmentPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/assessment");
  if (user.app_metadata?.role !== "candidate") redirect("/dashboard");

  const admin = getAdminClient();
  const { data: candidate, error } = await admin
    .from("candidates")
    .select(
      "id, english_mc_score, english_comprehension_score, english_written_tier, english_percentile, retake_available_at, permanently_blocked, english_attempts_exhausted, retake_count"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new Error(`candidate lookup failed: ${error.message}`);
  // The application form creates the candidate row — without one there is
  // nothing to assess yet.
  if (!candidate) redirect("/apply");

  const passed =
    (candidate.english_mc_score ?? 0) >= 70 && (candidate.english_comprehension_score ?? 0) >= 70;

  let mode: "run" | "passed" | "cooldown" | "blocked" | "grade_retry" | "unpaid" = "run";
  // Server component: "render" is once per request, so reading the clock is
  // the correct per-request behavior, not a purity bug.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  if (passed) mode = "passed";
  else if (candidate.permanently_blocked || candidate.english_attempts_exhausted) mode = "blocked";
  else if (
    candidate.retake_available_at &&
    new Date(candidate.retake_available_at).getTime() > now
  )
    mode = "cooldown";

  // A submitted-but-ungraded attempt (vendor failure, crashed grader, or a
  // closed tab) is RECOVERABLE — the answers are on the attempt row. Offer
  // the scoring retry instead of restarting a 25-minute proctored test.
  let pendingAttemptId: string | null = null;
  if (mode === "run") {
    const { data: pendingAttempt } = await admin
      .from("test_attempts")
      .select("id, status")
      .eq("candidate_id", candidate.id)
      .in("status", ["submitted", "grading", "grading_failed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pendingAttempt) {
      mode = "grade_retry";
      pendingAttemptId = pendingAttempt.id;
    }
  }

  // The assessment is paid now. Decide it HERE rather than letting the deal
  // route refuse: AssessmentClient takes the browser fullscreen and starts
  // the proctor before it ever calls the API, so a payment check that only
  // lives in the API means the candidate is locked into a proctored session
  // and then told no. The route keeps its own 402 — that one is the actual
  // enforcement, and this is the one that keeps the screen honest.
  //
  // Only 'run' is gated. A grade_retry is finishing a sitting they already
  // paid for, and cooldown/blocked/passed never reach the test at all.
  //
  // The predicate is "paid, unsettled, unrefunded" — a purchase CLAIMED by an
  // in-progress attempt still counts. It briefly did not, and the result was
  // the worst bug in this feature: a candidate who reloaded ten minutes into
  // the test was shown "You don't have a sitting yet" and offered to buy a
  // second one, while the attempt they had paid for ran out its clock in the
  // background.
  if (mode === "run") {
    // First sitting free (20260911201321). This page reads the entitlement
    // DIRECTLY rather than going through /api/test/questions, so without a
    // grant here a first-time candidate had no row, fell to mode "unpaid",
    // and was shown "You don't have a sitting yet — it costs $5" with a link
    // back to the dashboard, whose button sent them straight back here. A
    // closed loop, and the $5 was the one price they could not even pay,
    // because the dashboard hides the Buy button while the sitting is free.
    await admin.rpc("grant_free_assessment_sitting", {
      p_candidate_id: candidate.id,
      p_kind: "english",
    });

    const { data: entitlement } = await admin
      .from("assessment_purchases")
      .select("id")
      .eq("candidate_id", candidate.id)
      .eq("kind", "english")
      .eq("status", "paid")
      .is("consumed_at", null)
      .is("refunded_at", null)
      .maybeSingle();
    if (!entitlement) mode = "unpaid";
  }

  const caps = assessmentCapabilities();

  return (
    <AssessmentClient
      candidateId={candidate.id}
      mode={mode}
      pendingAttemptId={pendingAttemptId}
      spokenParts={caps.spoken}
      writingPart={caps.writing}
      retakeAvailableAt={candidate.retake_available_at}
      tier={candidate.english_written_tier}
    />
  );
}
