import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { transcribeAudio } from "@/lib/deepgram";
import {
  applySttConfidenceGuard,
  applyWritingWordGuard,
  compositeComprehension,
  gradeOpenParts,
  readAloudScore,
  type OpenPartInput,
} from "@/lib/assessment";

/**
 * Grades a submitted assessment attempt — MC sections instantly, open parts
 * via Deepgram + the Claude rubric — then writes the candidate's scores and
 * the retake/lockout consequences. Extracted from /api/test/submit so the
 * retry route can re-run a vendor-failed grading without re-submitting.
 *
 * Exactly-one-grader is a DATABASE claim: the attempt moves
 * submitted|grading_failed -> grading in one conditional UPDATE. Everything
 * non-idempotent (retake_count, lockout rows, emails) happens only after a
 * successful claim and only on the terminal transition to 'graded'.
 */

function assignWrittenTier(percentile: number): string | null {
  if (percentile >= 90) return "exceptional";
  if (percentile >= 75) return "proficient";
  if (percentile >= 70) return "competent";
  return null;
}

/** Attempts 1-2: 3 days, attempt 3: 6, attempt 4: 14, attempt 5+: permanent. */
function getLockoutDays(attemptNumber: number): number | null {
  if (attemptNumber >= 5) return null;
  if (attemptNumber >= 4) return 14;
  if (attemptNumber >= 3) return 6;
  return 3;
}

interface ServedQuestion {
  qid: string;
  eph: string;
  map: number[];
}

export type GradeOutcome =
  | { status: "graded"; passed: boolean; result: Record<string, unknown> }
  | { status: "pending"; reason: string }
  | { status: "expired" }
  | { status: "already"; attemptStatus: string };

const RECORDINGS_BUCKET = "voice-recordings";
/** Late means late: this mirrors the submit route's grace exactly. */
const GRACE_MS = 120_000;
/** A 'grading' row older than this is a crashed grader, reclaimable. Well
 * above the worst honest grade (3 downloads + 3×20s Deepgram + 60s Claude). */
const GRADING_LEASE_MS = 10 * 60 * 1000;

export async function gradeAttempt(
  supabase: SupabaseClient,
  candidateId: string,
  attemptId: string
): Promise<GradeOutcome> {
  // ── The claim ── (also reclaims crashed graders past the lease: a death
  // between claim and terminal write used to strand the attempt at
  // 'grading' forever, with no retry able to touch it)
  const leaseCutoff = new Date(Date.now() - GRADING_LEASE_MS).toISOString();
  const { data: attempt } = await supabase
    .from("test_attempts")
    .update({ status: "grading", grading_started_at: new Date().toISOString() })
    .eq("id", attemptId)
    .eq("candidate_id", candidateId)
    .or(
      `status.in.(submitted,grading_failed),and(status.eq.grading,grading_started_at.lt.${leaseCutoff})`
    )
    .select("id, questions, open_answers, recordings, expires_at, submitted_at, created_at")
    .maybeSingle();

  if (!attempt) {
    const { data: current } = await supabase
      .from("test_attempts")
      .select("status")
      .eq("id", attemptId)
      .eq("candidate_id", candidateId)
      .maybeSingle();
    return { status: "already", attemptStatus: current?.status || "missing" };
  }

  // ── The deadline, enforced where grading is serialized ── The submit
  // route 410s late submissions but stores them; without this check, one
  // POST /api/test/grade graded the stored answers anyway — hold the
  // attempt open all night, submit late, eat the 410, collect a pass.
  const submittedLate =
    attempt.submitted_at &&
    new Date(attempt.submitted_at).getTime() >
      new Date(attempt.expires_at).getTime() + GRACE_MS;
  if (submittedLate) {
    await supabase.from("test_attempts").update({ status: "expired" }).eq("id", attemptId);
    return { status: "expired" };
  }

  // ── Supersession ── Regrading a stale failed attempt must never
  // overwrite the candidate's scores from a NEWER attempt. A newer attempt
  // that itself EXPIRED doesn't count — expired garbage must not kill a
  // recoverable one. (The check is claim-time; the residual race of an
  // older grade finishing after a newer submit is accepted as tiny.)
  const { data: newer } = await supabase
    .from("test_attempts")
    .select("id")
    .eq("candidate_id", candidateId)
    .gt("created_at", attempt.created_at)
    .not("submitted_at", "is", null)
    .neq("status", "expired")
    .limit(1)
    .maybeSingle();
  if (newer) {
    await supabase.from("test_attempts").update({ status: "expired" }).eq("id", attemptId);
    return { status: "expired" };
  }

  const parkFailed = async (reason: string): Promise<GradeOutcome> => {
    console.error(`[grade-attempt] ${attemptId}: ${reason}`);
    await supabase
      .from("test_attempts")
      .update({ status: "grading_failed" })
      .eq("id", attemptId);
    // The swallow-and-continue pattern is what buried every past vendor
    // failure — record it where the health check looks.
    await supabase
      .from("vendor_failures")
      .insert({
        app: "platform",
        vendor: "assessment_grading",
        operation: "grade_attempt",
        fatal: true,
        message: reason.slice(0, 500),
        context: { candidate_id: candidateId, attempt_id: attemptId },
      })
      .then(({ error }) => {
        if (error) console.error("[grade-attempt] vendor_failures insert failed:", error.message);
      });
    return { status: "pending", reason };
  };

  try {
    const served = attempt.questions as ServedQuestion[];
    const openAnswers = (attempt.open_answers || {}) as {
      mc?: Record<string, number>;
      write?: Record<string, string>;
      flags?: Record<string, string>;
    };
    const recordings = (attempt.recordings || {}) as Record<string, string>;
    const flags = openAnswers.flags || {};

    const { data: questions } = await supabase
      .from("english_test_questions")
      .select("id, section, question_text, listen_script, correct_answer, min_words, max_words")
      .in("id", served.map((s) => s.qid));
    if (!questions || questions.length !== served.length) {
      return await parkFailed("failed to load served questions");
    }
    const questionById = new Map(questions.map((q) => [q.id, q]));

    // ── MC sections ──
    let grammarCorrect = 0,
      grammarTotal = 0,
      compCorrect = 0,
      compTotal = 0;
    const mcAnswers = openAnswers.mc || {};
    const answerRecords: Record<string, unknown>[] = [];

    for (const s of served) {
      const q = questionById.get(s.qid)!;
      if (q.section !== "grammar" && q.section !== "comprehension") continue;
      const displayIndex = mcAnswers[s.eph];
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
      answerRecords.push({
        candidate_id: candidateId,
        question_id: q.id,
        attempt_id: attempt.id,
        selected_answer: selectedAnswer,
        is_correct: isCorrect,
      });
    }

    const grammarScore = grammarTotal > 0 ? Math.round((grammarCorrect / grammarTotal) * 100) : 0;
    const compMcScore = compTotal > 0 ? Math.round((compCorrect / compTotal) * 100) : 0;

    // ── Open parts ──
    const partScores: Record<string, number | null> = {
      comprehension: compTotal > 0 ? compMcScore : null,
      read_aloud: null,
      listening: null,
      speaking: null,
      writing: null,
    };
    const partNotes: Record<string, string> = {};
    const openInputs: OpenPartInput[] = [];

    for (const s of served) {
      const q = questionById.get(s.qid)!;
      if (q.section === "grammar" || q.section === "comprehension") continue;

      if (q.section === "writing") {
        const text = (openAnswers.write || {})[s.eph] || "";
        openInputs.push({
          part: "writing",
          prompt: q.question_text,
          response: text,
          minWords: q.min_words,
          maxWords: q.max_words,
        });
        continue;
      }

      // A listening item whose prompt audio failed to play is a broken
      // QUESTION, not a wrong answer: the part scores null and its weight
      // redistributes, exactly as if it hadn't been dealt. The flag is
      // candidate-reported (nothing server-side can see their <audio>), so
      // it's only honored when no recording was submitted either — you
      // can't answer the question AND claim you never heard it.
      const path = recordings[s.eph];
      if (q.section === "listening" && flags[s.eph] === "audio_failed" && !path) {
        partScores.listening = null;
        partNotes.listening =
          "Candidate reported the prompt audio failed to play; part excluded from scoring.";
        continue;
      }

      // Spoken parts: download the uploaded recording and transcribe it. A
      // missing or empty recording is a real result (no response), not an
      // infrastructure failure — it scores 0 without a vendor call.
      if (!path || !path.startsWith(`${candidateId}/assessment/${attempt.id}/`)) {
        partScores[q.section] = 0;
        partNotes[q.section] = "No recording was submitted for this part.";
        continue;
      }
      const { data: file, error: dlErr } = await supabase.storage
        .from(RECORDINGS_BUCKET)
        .download(path);
      if (dlErr || !file) {
        return await parkFailed(`recording download failed for ${q.section}: ${dlErr?.message}`);
      }
      const transcript = await transcribeAudio(await file.arrayBuffer());

      if (q.section === "read_aloud") {
        const raw = readAloudScore(q.question_text, transcript.text);
        const guarded = applySttConfidenceGuard(raw, transcript.confidence);
        partScores.read_aloud = guarded;
        partNotes.read_aloud =
          `Word accuracy vs the passage (STT confidence ${transcript.confidence?.toFixed(2) ?? "n/a"}` +
          (guarded !== raw ? `; low-confidence audio floored the score from ${raw}` : "") +
          `).`;
      } else {
        openInputs.push({
          part: q.section as "listening" | "speaking",
          prompt: q.section === "listening" ? q.listen_script || q.question_text : q.question_text,
          response: transcript.text,
          sttConfidence: transcript.confidence,
        });
      }
    }

    if (openInputs.length > 0) {
      const graded = await gradeOpenParts(openInputs);
      for (const input of openInputs) {
        const g = graded[input.part];
        let score = g.score;
        if (input.part === "writing") {
          score = applyWritingWordGuard(score, input.response, input.minWords);
        }
        partScores[input.part] = score;
        partNotes[input.part] = g.note;
      }
    }

    // ── Composition ──
    const comprehensionComposite = compositeComprehension(partScores);
    const hasOpenParts = ["read_aloud", "listening", "speaking", "writing"].some(
      (k) => typeof partScores[k] === "number"
    );
    // MC-only attempts (vendors gated off) keep the OLD percentile formula
    // exactly — the pooled served-set percent — so a candidate graded this
    // week is score-identical to one graded before step 8. The (grammar +
    // composite)/2 semantic only applies when open parts actually ran.
    const overall = hasOpenParts
      ? Math.round((grammarScore + comprehensionComposite) / 2)
      : Math.round(((grammarCorrect + compCorrect) / Math.max(1, grammarTotal + compTotal)) * 100);
    const passed = grammarScore >= 70 && comprehensionComposite >= 70;
    const tier = passed ? assignWrittenTier(overall) : null;

    if (answerRecords.length > 0) {
      // Idempotent under regrades: a reclaimed lease or retried grading
      // must not double-insert answer rows.
      await supabase.from("candidate_test_answers").delete().eq("attempt_id", attempt.id);
      await supabase.from("candidate_test_answers").insert(answerRecords);
    }

    // ── Candidate writes + retake/lockout consequences ──
    const { data: currentCandidate } = await supabase
      .from("candidates")
      .select("retake_count, email, display_name, full_name")
      .eq("id", candidateId)
      .single();

    // The retake/lockout consequences are NOT idempotent (counter RPC,
    // lockout rows, emails), and the lease makes regrading a crashed
    // attempt a designed path. A flag on the attempt row, written BEFORE
    // the consequences, makes them once-per-attempt: a regrade recomputes
    // scores freely but never punishes twice. (Crash between flag and
    // consequence loses at most one lockout escalation — the lenient side.)
    const consequencesAlreadyApplied = (openAnswers as { consequences_applied?: boolean })
      .consequences_applied === true;
    const applyConsequences = !passed && !consequencesAlreadyApplied;
    if (applyConsequences) {
      await supabase
        .from("test_attempts")
        .update({ open_answers: { ...openAnswers, consequences_applied: true } })
        .eq("id", attemptId);
    }

    let retakeCount = currentCandidate?.retake_count ?? 0;
    if (applyConsequences) {
      const { data: newCount } = await supabase.rpc("increment_retake_count", {
        p_candidate_id: candidateId,
      });
      retakeCount = typeof newCount === "number" ? newCount : retakeCount + 1;
    }

    const updateData: Record<string, unknown> = {
      english_mc_score: grammarScore,
      english_comprehension_score: comprehensionComposite,
      english_percentile: overall,
      english_written_tier: tier,
      score_mismatch_flag: overall > 80,
      test_completed_at: new Date().toISOString(),
      results_display_unlocked: true,
    };

    if (applyConsequences) {
      const { data: identityRecord } = await supabase
        .from("verified_identities")
        .select("identity_hash")
        .eq("candidate_id", candidateId)
        .eq("is_duplicate", false)
        .single();

      if (identityRecord?.identity_hash) {
        const { count: previousAttempts } = await supabase
          .from("english_test_lockouts")
          .select("*", { count: "exact", head: true })
          .eq("identity_hash", identityRecord.identity_hash);
        const attemptNumber = (previousAttempts || 0) + 1;
        const lockoutDays = getLockoutDays(attemptNumber);

        if (lockoutDays === null) {
          updateData.permanently_blocked = true;
          await supabase.from("english_test_lockouts").insert({
            identity_hash: identityRecord.identity_hash,
            candidate_id: candidateId,
            attempt_number: attemptNumber,
          });
          if (process.env.RESEND_API_KEY && currentCandidate?.email) {
            const firstName =
              (currentCandidate.display_name || currentCandidate.full_name || "").split(" ")[0] ||
              "there";
            try {
              await sendEmail({
                from: "StaffVA <notifications@staffva.com>",
                to: currentCandidate.email,
                subject: "StaffVA Application Update",
                html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;"><h2 style="color:#1C1B1A;">Application Update</h2><p style="color:#444;font-size:14px;">Hi ${firstName},</p><p style="color:#444;font-size:14px;line-height:1.6;">After multiple attempts, we are unable to advance your application at this time.</p><p style="color:#444;font-size:14px;line-height:1.6;">You may reapply in <strong>90 days</strong>. We encourage you to continue developing your English language skills during this time.</p><p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p></div>`,
              }, { recipientKind: "candidate", emailType: "assessment_result" });
            } catch {
              /* silent */
            }
          }
          // The admin heads-up the old route sent — a permanent block is a
          // human-review event, not just a row change.
          if (process.env.RESEND_API_KEY) {
            try {
              await sendEmail({
                from: "StaffVA <notifications@staffva.com>",
                to: "sam@glostaffing.com",
                subject: `Candidate permanently blocked after ${attemptNumber} test failures`,
                html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;"><h2 style="color:#1C1B1A;">Permanent Block Notification</h2><p style="color:#444;font-size:14px;">Candidate <strong>${currentCandidate?.display_name || currentCandidate?.full_name}</strong> (${currentCandidate?.email}) has been permanently blocked after ${attemptNumber} failed English test attempts.</p><p style="color:#444;font-size:14px;">Identity hash: ${identityRecord.identity_hash.slice(0, 16)}...</p></div>`,
              });
            } catch {
              /* silent */
            }
          }
        } else {
          const lockoutExpiry = new Date();
          lockoutExpiry.setDate(lockoutExpiry.getDate() + lockoutDays);
          updateData.retake_available_at = lockoutExpiry.toISOString();
          await supabase.from("english_test_lockouts").insert({
            identity_hash: identityRecord.identity_hash,
            candidate_id: candidateId,
            attempt_number: attemptNumber,
            lockout_expires_at: lockoutExpiry.toISOString(),
          });
        }
      } else {
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

    const finalParts = {
      grammar: grammarScore,
      ...partScores,
      overall,
      notes: partNotes,
    };
    await supabase
      .from("test_attempts")
      .update({ status: "graded", graded_at: new Date().toISOString(), part_scores: finalParts })
      .eq("id", attemptId);

    if (passed) {
      try {
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";
        fetch(`${siteUrl}/api/candidate-emails`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`,
          },
          body: JSON.stringify({
            candidateId,
            emailType: "english_test_passed",
            data: { tier: tier || "" },
          }),
        }).catch(() => {});
      } catch {
        /* non-fatal */
      }
    }

    return {
      status: "graded",
      passed,
      result: {
        passed,
        grammarScore,
        compScore: comprehensionComposite,
        combinedScore: overall,
        tier,
        partScores: finalParts,
        candidate: updatedCandidate,
      },
    };
  } catch (err) {
    return await parkFailed(err instanceof Error ? err.message : "unknown grading error");
  }
}
