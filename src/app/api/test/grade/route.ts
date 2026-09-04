import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { ownsCandidate } from "@/lib/auth";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";
import { gradeAttempt } from "@/lib/gradeAttempt";

// Same reasoning as submit: the grade runs in-request against two paid
// vendors and must not be killed by a short platform default.
export const maxDuration = 300;

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/test/grade — retry grading for a submitted attempt.
 *
 * The recovery path for vendor failures during grading: the answers and
 * recordings are safe on the attempt row, so the assessment page (or the
 * dashboard) can ask again without the candidate redoing anything. The
 * grading claim in lib/gradeAttempt makes concurrent retries safe; the
 * rate limit keeps this from being an unmetered pump for Deepgram/Claude
 * spend and vendor_failures noise.
 */
export async function POST(request: NextRequest) {
  const { candidateId, attemptId } = await request.json();
  if (!candidateId || !attemptId) {
    return NextResponse.json({ error: "Missing data" }, { status: 400 });
  }
  if (!(await ownsCandidate(candidateId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const authClient = await createServerClient();
  const { data: aal } = await authClient.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.currentLevel !== aal.nextLevel) { // fail CLOSED: an unreadable AAL is not a satisfied one
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const limited = await enforceRateLimit(`test-grade:${candidateId}`, LIMITS.gradeRetry);
  if (limited) return limited;

  const outcome = await gradeAttempt(getAdminClient(), candidateId, attemptId);
  if (outcome.status === "graded") return NextResponse.json(outcome.result);
  if (outcome.status === "pending") return NextResponse.json({ pending: true });
  if (outcome.status === "expired") {
    return NextResponse.json(
      { error: "This attempt's time expired before it was submitted.", expired: true },
      { status: 410 }
    );
  }
  return NextResponse.json(
    outcome.attemptStatus === "graded"
      ? { alreadyGraded: true }
      : { pending: true, attemptStatus: outcome.attemptStatus }
  );
}
