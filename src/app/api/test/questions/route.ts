import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

  const supabase = getAdminClient();

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
