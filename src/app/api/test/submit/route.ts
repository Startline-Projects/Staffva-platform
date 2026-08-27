import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { ownsCandidate } from "@/lib/auth";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function assignWrittenTier(percentile: number): string | null {
  if (percentile >= 90) return "exceptional";
  if (percentile >= 75) return "proficient";
  if (percentile >= 70) return "competent";
  return null;
}

/**
 * Get lockout duration based on attempt number.
 * Attempts 1-2: 3 days, Attempt 3: 6 days, Attempt 4: 14 days, Attempt 5+: permanent
 */
function getLockoutDays(attemptNumber: number): number | null {
  if (attemptNumber >= 5) return null; // permanent block
  if (attemptNumber >= 4) return 14;
  if (attemptNumber >= 3) return 6;
  return 3; // attempts 1-2
}

export async function POST(request: Request) {
  const { candidateId, attemptId, answers, timeRemaining } = await request.json();

  if (!candidateId || !attemptId || !answers || typeof answers !== "object") {
    return NextResponse.json({ error: "Missing data" }, { status: 400 });
  }

  // Only the candidate who owns this record may submit their test. Previously
  // unauthenticated: anyone could grade a test for any candidateId (forcing a
  // pass for themselves, or a failure + lockout for someone else).
  if (!(await ownsCandidate(candidateId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = getAdminClient();

  // ═══ GRADE AGAINST THE SERVED ATTEMPT ═══
  //
  // The old grading ran over Object.keys(answers) — whatever set the CANDIDATE
  // chose to submit. Answer only the ten questions you were sure of and you
  // scored 10/10; the server had no record of the twenty it served. Grading
  // now runs over the attempt row the questions route stored: every served
  // question is graded, unanswered means wrong, the client's display indices
  // are translated through the server-held permutation, and the deadline on
  // the attempt is enforced with a one-minute grace for slow networks.
  //
  // The claim is atomic (submitted_at IS NULL in the WHERE): a double submit —
  // two tabs, a retry racing the original — grades exactly once.
  const { data: attempt } = await supabase
    .from("test_attempts")
    .update({ submitted_at: new Date().toISOString() })
    .eq("id", attemptId)
    .eq("candidate_id", candidateId)
    .is("submitted_at", null)
    .select("id, questions, expires_at")
    .maybeSingle();

  if (!attempt) {
    return NextResponse.json(
      { error: "This test attempt was already submitted or does not exist." },
      { status: 409 }
    );
  }

  const GRACE_MS = 60_000;
  if (Date.now() > new Date(attempt.expires_at).getTime() + GRACE_MS) {
    return NextResponse.json(
      { error: "Time expired for this attempt. Please start the test again." },
      { status: 410 }
    );
  }

  interface ServedQuestion { qid: string; eph: string; map: number[] }
  const served = attempt.questions as ServedQuestion[];

  const { data: questions } = await supabase
    .from("english_test_questions")
    .select("id, section, correct_answer")
    .in("id", served.map((s) => s.qid));

  if (!questions || questions.length !== served.length) {
    return NextResponse.json({ error: "Failed to load answers" }, { status: 500 });
  }

  const questionById = new Map(questions.map((q) => [q.id, q]));

  // Grade each SERVED question
  let grammarCorrect = 0;
  let grammarTotal = 0;
  let compCorrect = 0;
  let compTotal = 0;

  const answerRecords = served.map((s) => {
    const q = questionById.get(s.qid)!;
    const displayIndex = (answers as Record<string, unknown>)[s.eph];
    // Translate display position -> original option index. An unanswered or
    // malformed entry stays null and grades as wrong.
    const selectedAnswer =
      typeof displayIndex === "number" &&
      Number.isInteger(displayIndex) &&
      displayIndex >= 0 &&
      displayIndex < s.map.length
        ? s.map[displayIndex]
        : null;
    const isCorrect = selectedAnswer !== null && selectedAnswer === q.correct_answer;

    if (q.section === "grammar") {
      grammarTotal++;
      if (isCorrect) grammarCorrect++;
    } else {
      compTotal++;
      if (isCorrect) compCorrect++;
    }

    return {
      candidate_id: candidateId,
      question_id: q.id,
      attempt_id: attempt.id,
      selected_answer: selectedAnswer,
      is_correct: isCorrect,
    };
  });

  await supabase.from("candidate_test_answers").insert(answerRecords);

  // Calculate scores
  const grammarScore = grammarTotal > 0 ? Math.round((grammarCorrect / grammarTotal) * 100) : 0;
  const compScore = compTotal > 0 ? Math.round((compCorrect / compTotal) * 100) : 0;
  const combinedScore = Math.round((grammarCorrect + compCorrect) / (grammarTotal + compTotal) * 100);

  const passed = grammarScore >= 70 && compScore >= 70;
  const tier = passed ? assignWrittenTier(combinedScore) : null;
  const scoreMismatch = combinedScore > 80;

  // Get current candidate for retake tracking + identity hash
  const { data: currentCandidate } = await supabase
    .from("candidates")
    .select("retake_count, email, display_name, full_name")
    .eq("id", candidateId)
    .single();

  // A failed attempt bumps retake_count in the database, not here. Reading
  // the value and adding one in TypeScript meant two concurrent failing
  // submissions both read N and both wrote N+1 — losing an attempt from the
  // counter that gates the retake lockout.
  let retakeCount = currentCandidate?.retake_count ?? 0;
  if (!passed) {
    const { data: newCount } = await supabase.rpc("increment_retake_count", {
      p_candidate_id: candidateId,
    });
    retakeCount = typeof newCount === "number" ? newCount : retakeCount + 1;
  }

  // Update candidate record
  const updateData: Record<string, unknown> = {
    english_mc_score: grammarScore,
    english_comprehension_score: compScore,
    english_percentile: combinedScore,
    english_written_tier: tier,
    score_mismatch_flag: scoreMismatch,
    test_completed_at: new Date().toISOString(),
    test_time_remaining_seconds: timeRemaining,
  };

  if (!passed) {
    // retake_count was already incremented atomically above; writing it here
    // too would reintroduce the lost update.

    // ═══ IDENTITY-HASH LOCKOUT SYSTEM ═══
    // Get identity hash for this candidate
    const { data: identityRecord } = await supabase
      .from("verified_identities")
      .select("identity_hash")
      .eq("candidate_id", candidateId)
      .eq("is_duplicate", false)
      .single();

    if (identityRecord?.identity_hash) {
      // Count previous lockouts for this identity hash
      const { count: previousAttempts } = await supabase
        .from("english_test_lockouts")
        .select("*", { count: "exact", head: true })
        .eq("identity_hash", identityRecord.identity_hash);

      const attemptNumber = (previousAttempts || 0) + 1;
      const lockoutDays = getLockoutDays(attemptNumber);

      if (lockoutDays === null) {
        // Permanent block (5+ attempts)
        updateData.permanently_blocked = true;

        // Insert final lockout record
        await supabase.from("english_test_lockouts").insert({
          identity_hash: identityRecord.identity_hash,
          candidate_id: candidateId,
          attempt_number: attemptNumber,
        });

        // Send permanent block email
        if (process.env.RESEND_API_KEY && currentCandidate?.email) {
          const firstName = (currentCandidate.display_name || currentCandidate.full_name || "").split(" ")[0] || "there";
          try {
            await sendEmail({
              from: "StaffVA <notifications@staffva.com>",
              to: currentCandidate.email,
              subject: "StaffVA Application Update",
              html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                <h2 style="color:#1C1B1A;">Application Update</h2>
                <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
                <p style="color:#444;font-size:14px;line-height:1.6;">After multiple attempts, we are unable to advance your application at this time.</p>
                <p style="color:#444;font-size:14px;line-height:1.6;">You may reapply in <strong>90 days</strong>. We encourage you to continue developing your English language skills during this time.</p>
                <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
              </div>`,
            });
          } catch { /* silent */ }
        }

        // Notify admin
        if (process.env.RESEND_API_KEY) {
          try {
            await sendEmail({
              from: "StaffVA <notifications@staffva.com>",
              to: "sam@glostaffing.com",
              subject: `Candidate permanently blocked after ${attemptNumber} test failures`,
              html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;">
                <h2 style="color:#1C1B1A;">Permanent Block Notification</h2>
                <p style="color:#444;font-size:14px;">Candidate <strong>${currentCandidate?.display_name || currentCandidate?.full_name}</strong> (${currentCandidate?.email}) has been permanently blocked after ${attemptNumber} failed English test attempts.</p>
                <p style="color:#444;font-size:14px;">Identity hash: ${identityRecord.identity_hash.slice(0, 16)}...</p>
              </div>`,
            });
          } catch { /* silent */ }
        }
      } else {
        // Timed lockout
        const lockoutExpiry = new Date();
        lockoutExpiry.setDate(lockoutExpiry.getDate() + lockoutDays);
        updateData.retake_available_at = lockoutExpiry.toISOString();

        // Insert lockout record — trigger auto-sets lockout_expires_at
        // But we override with our escalating duration
        await supabase.from("english_test_lockouts").insert({
          identity_hash: identityRecord.identity_hash,
          candidate_id: candidateId,
          attempt_number: attemptNumber,
          lockout_expires_at: lockoutExpiry.toISOString(),
        });
      }
    } else {
      // No identity hash — fall back to candidate-level lockout (legacy)
      const permanentlyBlocked = retakeCount >= 5;
      updateData.permanently_blocked = permanentlyBlocked;
      if (!permanentlyBlocked) {
        const retakeDate = new Date();
        retakeDate.setDate(retakeDate.getDate() + 3);
        updateData.retake_available_at = retakeDate.toISOString();
      }
    }
  }

  const { data: updatedCandidate } = await supabase
    .from("candidates")
    .update(updateData)
    .eq("id", candidateId)
    .select()
    .single();

  // Trigger 3: English test passed email
  if (passed) {
    try {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";
      fetch(`${siteUrl}/api/candidate-emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Internal server-to-server call — authenticate to the gated route.
          authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`,
        },
        body: JSON.stringify({
          candidateId,
          emailType: "english_test_passed",
          data: { tier: tier || "" },
        }),
      }).catch(() => {});
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({
    passed,
    grammarScore,
    compScore,
    combinedScore,
    tier,
    candidate: updatedCandidate,
  });
}
