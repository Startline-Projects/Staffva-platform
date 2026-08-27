import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { ownsCandidate } from "@/lib/auth";

// Use service role to bypass RLS on questions table
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Matches the client's timer (15 min) plus grace for network and load time.
// The attempt's expires_at is what the SERVER enforces at grading; the client
// timer is UX.
const ATTEMPT_LIFETIME_MS = (15 * 60 + 120) * 1000;

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

interface ServedQuestion {
  qid: string;      // real question uuid — never leaves the server
  eph: string;      // per-attempt id — the only id the client ever sees
  map: number[];    // display position -> original option index
}

interface QuestionRow {
  id: string;
  section: string;
  question_text: string;
  options: string[];
}

/**
 * POST /api/test/questions — deal (or re-deal) a test attempt.
 *
 * The attempt is server-held state: which questions were served, under which
 * per-attempt ids, with which option permutation, and until when. The client
 * receives ephemeral ids and shuffled options — never real ids, never the
 * permutation, never the key. This closes four holes at once:
 *
 *  - a shared answer key cannot be translated: real ids and the permutation
 *    stay server-side, so there is nothing stable to key on;
 *  - refreshing the page re-serves the SAME attempt instead of dealing a
 *    fresh hand, so the bank cannot be farmed by reload;
 *  - grading (in /api/test/submit) runs over the served set, so answering
 *    only the questions you like no longer works;
 *  - the deadline lives on the attempt row, where grading can enforce it.
 */
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

  // ═══ RESUME AN OPEN ATTEMPT ═══
  // An unexpired, unsubmitted attempt is re-served as-is: same questions, same
  // order, same option permutation, same deadline.
  const { data: openAttempt } = await supabase
    .from("test_attempts")
    .select("id, questions, passage_id, expires_at")
    .eq("candidate_id", candidateId)
    .is("submitted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (openAttempt) {
    const served = openAttempt.questions as ServedQuestion[];
    const realIds = served.map((s) => s.qid);
    const { data: rows } = await supabase
      .from("english_test_questions")
      .select("id, section, question_text, options")
      .in("id", realIds);

    if (rows && rows.length === served.length) {
      const byId = new Map((rows as QuestionRow[]).map((r) => [r.id, r]));
      const questions = served.map((s) => {
        const q = byId.get(s.qid)!;
        return {
          id: s.eph,
          section: q.section,
          question_text: q.question_text,
          options: s.map.map((origIdx) => (q.options as string[])[origIdx]),
        };
      });

      let passageText: string | null = null;
      if (openAttempt.passage_id) {
        const { data: p } = await supabase
          .from("english_test_passages")
          .select("passage_text")
          .eq("id", openAttempt.passage_id)
          .single();
        passageText = p?.passage_text ?? null;
      }

      return NextResponse.json({
        attemptId: openAttempt.id,
        expiresAt: openAttempt.expires_at,
        passage: passageText,
        questions,
      });
    }
    // A served question has vanished from the bank (deactivated mid-attempt):
    // fall through and deal a fresh attempt rather than serve a broken one.
  }

  // ═══ DEAL A FRESH ATTEMPT ═══
  const { data: grammarQuestions } = await supabase
    .from("english_test_questions")
    .select("id, section, question_text, options")
    .eq("section", "grammar")
    .eq("active", true);

  // One passage per attempt, chosen at random from the active bank, with its
  // questions. The old design served THE one hardcoded passage to everyone on
  // every attempt — a five-item answer key that leaked once and stayed leaked.
  const { data: passages } = await supabase
    .from("english_test_passages")
    .select("id")
    .eq("active", true);

  if (!grammarQuestions || !passages || passages.length === 0) {
    return NextResponse.json(
      { error: "Failed to load questions" },
      { status: 500 }
    );
  }

  const passageId = passages[Math.floor(Math.random() * passages.length)].id;

  const [{ data: compQuestions }, { data: passageRow }] = await Promise.all([
    supabase
      .from("english_test_questions")
      .select("id, section, question_text, options")
      .eq("section", "comprehension")
      .eq("active", true)
      .eq("passage_id", passageId)
      .order("display_order"),
    supabase
      .from("english_test_passages")
      .select("passage_text")
      .eq("id", passageId)
      .single(),
  ]);

  if (!compQuestions || compQuestions.length === 0 || !passageRow) {
    return NextResponse.json(
      { error: "Failed to load questions" },
      { status: 500 }
    );
  }

  const selectedGrammar = shuffleArray(grammarQuestions as QuestionRow[]).slice(0, 20);
  const orderedRows = [...selectedGrammar, ...(compQuestions as QuestionRow[])];

  // Build the server-held record and the client payload together.
  const served: ServedQuestion[] = [];
  const clientQuestions = orderedRows.map((q) => {
    const options = q.options as string[];
    const map = shuffleArray(options.map((_, i) => i));
    const eph = randomUUID();
    served.push({ qid: q.id, eph, map });
    return {
      id: eph,
      section: q.section,
      question_text: q.question_text,
      options: map.map((origIdx) => options[origIdx]),
    };
  });

  // Grammar order is shuffled for display; comprehension stays last and in
  // display order. Shuffle the paired arrays together so the server record
  // matches what the client sees.
  const grammarPairs = clientQuestions
    .map((cq, i) => ({ cq, sv: served[i] }))
    .filter((p) => p.cq.section === "grammar");
  const compPairs = clientQuestions
    .map((cq, i) => ({ cq, sv: served[i] }))
    .filter((p) => p.cq.section === "comprehension");
  const shuffledGrammar = shuffleArray(grammarPairs);
  const finalPairs = [...shuffledGrammar, ...compPairs];

  const expiresAt = new Date(Date.now() + ATTEMPT_LIFETIME_MS).toISOString();

  const { data: attempt, error: attemptError } = await supabase
    .from("test_attempts")
    .insert({
      candidate_id: candidateId,
      questions: finalPairs.map((p) => p.sv),
      passage_id: passageId,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (attemptError || !attempt) {
    console.error("[test-questions] attempt insert failed:", attemptError?.message);
    return NextResponse.json({ error: "Failed to start test" }, { status: 500 });
  }

  return NextResponse.json({
    attemptId: attempt.id,
    expiresAt,
    passage: passageRow.passage_text,
    questions: finalPairs.map((p) => p.cq),
  });
}
