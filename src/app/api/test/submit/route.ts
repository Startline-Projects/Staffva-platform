import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  return null; // below 70 = fail
}

export async function POST(request: Request) {
  const { candidateId, answers, timeRemaining } = await request.json();

  if (!candidateId || !answers) {
    return NextResponse.json({ error: "Missing data" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Fetch the correct answers for all answered questions
  const questionIds = Object.keys(answers);
  const { data: questions } = await supabase
    .from("english_test_questions")
    .select("id, section, correct_answer")
    .in("id", questionIds);

  if (!questions) {
    return NextResponse.json(
      { error: "Failed to load answers" },
      { status: 500 }
    );
  }

  // Grade each answer
  let grammarCorrect = 0;
  let grammarTotal = 0;
  let compCorrect = 0;
  let compTotal = 0;

  const answerRecords = questions.map((q) => {
    const selectedAnswer = answers[q.id] as number;
    const isCorrect = selectedAnswer === q.correct_answer;

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
      selected_answer: selectedAnswer,
      is_correct: isCorrect,
    };
  });

  // Save all answers
  await supabase.from("candidate_test_answers").insert(answerRecords);

  // Calculate scores
  const grammarScore =
    grammarTotal > 0 ? Math.round((grammarCorrect / grammarTotal) * 100) : 0;
  const compScore =
    compTotal > 0 ? Math.round((compCorrect / compTotal) * 100) : 0;

  // Combined percentile (weighted: 80% grammar, 20% comprehension since grammar has 20 questions)
  const combinedScore = Math.round(
    (grammarCorrect + compCorrect) /
      (grammarTotal + compTotal) *
      100
  );

  const passed = grammarScore >= 70 && compScore >= 70;
  const tier = passed ? assignWrittenTier(combinedScore) : null;
  const scoreMismatch = combinedScore > 80;

  // Get current candidate for retake tracking
  const { data: currentCandidate } = await supabase
    .from("candidates")
    .select("retake_count")
    .eq("id", candidateId)
    .single();

  const retakeCount = (currentCandidate?.retake_count ?? 0) + (passed ? 0 : 1);
  const permanentlyBlocked = !passed && retakeCount >= 2;

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
    updateData.retake_count = retakeCount;
    updateData.permanently_blocked = permanentlyBlocked;
    if (!permanentlyBlocked) {
      // Allow retake after 7 days
      const retakeDate = new Date();
      retakeDate.setDate(retakeDate.getDate() + 7);
      updateData.retake_available_at = retakeDate.toISOString();
    }
  }

  const { data: updatedCandidate } = await supabase
    .from("candidates")
    .update(updateData)
    .eq("id", candidateId)
    .select()
    .single();

  return NextResponse.json({
    passed,
    grammarScore,
    compScore,
    combinedScore,
    tier,
    candidate: updatedCandidate,
  });
}
