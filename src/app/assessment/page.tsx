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
      "id, english_mc_score, english_comprehension_score, english_written_tier, english_percentile, retake_available_at, permanently_blocked, retake_count"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new Error(`candidate lookup failed: ${error.message}`);
  // The application form creates the candidate row — without one there is
  // nothing to assess yet.
  if (!candidate) redirect("/apply");

  const passed =
    (candidate.english_mc_score ?? 0) >= 70 && (candidate.english_comprehension_score ?? 0) >= 70;

  let mode: "run" | "passed" | "cooldown" | "blocked" | "grade_retry" = "run";
  // Server component: "render" is once per request, so reading the clock is
  // the correct per-request behavior, not a purity bug.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  if (passed) mode = "passed";
  else if (candidate.permanently_blocked) mode = "blocked";
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
