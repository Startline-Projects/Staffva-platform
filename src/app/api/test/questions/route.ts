import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ownsCandidate } from "@/lib/auth";

// Use service role to bypass RLS on questions table
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export async function POST(request: Request) {
  const { candidateId } = await request.json();

  if (!candidateId) {
    return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });
  }

  if (!(await ownsCandidate(candidateId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = getAdminClient();

  // ═══ IDENTITY-HASH LOCKOUT ENFORCEMENT ═══
  // Check lockout by identity hash — cannot be bypassed by new accounts
  const { data: identityRecord } = await supabase
    .from("verified_identities")
    .select("identity_hash")
    .eq("candidate_id", candidateId)
    .eq("is_duplicate", false)
    .single();

  if (identityRecord?.identity_hash) {
    const { data: lockoutResult } = await supabase.rpc("check_identity_lockout", {
      p_identity_hash: identityRecord.identity_hash,
    });

    const lockout = lockoutResult as { is_locked: boolean; lockout_expires_at: string | null } | null;

    if (lockout?.is_locked) {
      return NextResponse.json({
        error: "English assessment locked",
        locked: true,
        lockout_expires_at: lockout.lockout_expires_at,
        message: "Your English assessment is currently locked due to a previous attempt. Please wait for the lockout period to expire.",
      }, { status: 403 });
    }
  }

  // Also check candidate-level permanent block
  const { data: candidateCheck } = await supabase
    .from("candidates")
    .select("permanently_blocked")
    .eq("id", candidateId)
    .single();

  if (candidateCheck?.permanently_blocked) {
    return NextResponse.json({
      error: "Permanently blocked",
      locked: true,
      permanent: true,
      message: "After multiple attempts, your English assessment access has been permanently suspended.",
    }, { status: 403 });
  }

  // Fetch 20 random grammar questions
  const { data: grammarQuestions } = await supabase
    .from("english_test_questions")
    .select("id, section, question_text, options, correct_answer")
    .eq("section", "grammar")
    .eq("active", true);

  // Fetch all comprehension questions
  const { data: compQuestions } = await supabase
    .from("english_test_questions")
    .select("id, section, question_text, options, correct_answer")
    .eq("section", "comprehension")
    .eq("active", true)
    .order("display_order");

  if (!grammarQuestions || !compQuestions) {
    return NextResponse.json(
      { error: "Failed to load questions" },
      { status: 500 }
    );
  }

  // Pick 20 random grammar questions
  const selectedGrammar = shuffleArray(grammarQuestions).slice(0, 20);

  // Shuffle answer options for each question and track the mapping
  const allQuestions = [...selectedGrammar, ...compQuestions].map((q) => {
    const options = q.options as string[];
    const indices = options.map((_: string, i: number) => i);
    const shuffledIndices = shuffleArray(indices) as number[];
    const shuffledOptions = shuffledIndices.map((i) => options[i]);

    return {
      id: q.id,
      section: q.section,
      question_text: q.question_text,
      options: shuffledOptions,
      shuffled_indices: shuffledIndices, // maps display position -> original index
    };
  });

  // Shuffle grammar questions order (comprehension stays at the end)
  const grammarPart = shuffleArray(
    allQuestions.filter((q) => q.section === "grammar")
  );
  const compPart = allQuestions.filter((q) => q.section === "comprehension");

  return NextResponse.json({
    questions: [...grammarPart, ...compPart],
  });
}
