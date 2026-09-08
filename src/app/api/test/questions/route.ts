import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { randomUUID } from "crypto";
import { ownsCandidate } from "@/lib/auth";
import { assessmentCapabilities } from "@/lib/assessment";
import { applicationClosed } from "@/lib/reviewOutcome";

// Use service role to bypass RLS on questions table
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// The attempt's expires_at is what the SERVER enforces at grading; the
// client's global countdown derives from it. The full Atlas assessment runs
// on a 24:30 clock; an MC-only deal (open parts vendor-gated off) keeps the
// old 15 minutes. Both get 120s grace for network and load time.
const FULL_LIFETIME_MS = (24 * 60 + 30 + 120) * 1000;
const MC_ONLY_LIFETIME_MS = (15 * 60 + 120) * 1000;

/** Listening prompt audio lives in the private recordings bucket; the
 * client gets a short-lived signed URL. */
const RECORDINGS_BUCKET = "voice-recordings";
const AUDIO_URL_TTL_SECONDS = 40 * 60;

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
  options: string[] | null;
  seconds?: number | null;
  min_words?: number | null;
  max_words?: number | null;
  audio_url?: string | null;
}

const OPEN_COLUMNS = "id, section, question_text, options, seconds, min_words, max_words, audio_url";

/** Shape one question row for the client — open items carry timing and (for
 * listening) a signed audio URL; MC items carry permuted options. The
 * correct answer, real id and listen_script never leave the server. */
async function toClientQuestion(
  supabase: ReturnType<typeof getAdminClient>,
  q: QuestionRow,
  s: ServedQuestion
) {
  const base: Record<string, unknown> = {
    id: s.eph,
    section: q.section,
    question_text: q.question_text,
    options: s.map.length > 0 ? s.map.map((origIdx) => (q.options as string[])[origIdx]) : [],
    seconds: q.seconds ?? null,
    min_words: q.min_words ?? null,
    max_words: q.max_words ?? null,
  };
  if (q.section === "listening" && q.audio_url) {
    const { data: signed, error: signErr } = await supabase.storage
      .from(RECORDINGS_BUCKET)
      .createSignedUrl(q.audio_url, AUDIO_URL_TTL_SECONDS);
    base.audio = signed?.signedUrl ?? null;
    // A failed mint used to end here, as a silent null. The client renders
    // the <audio> element only when a URL is present, so with null there is
    // no element, no onError, and therefore no way for the candidate to
    // report a failure they were never shown — while the play button stays
    // enabled and the meter still promises "Plays left · 2". Grading then
    // scores the part 0 and that zero counts in the denominator.
    //
    // The caller decides what to do (drop the item when dealing, flag the
    // attempt when resuming); this just refuses to lose the fact.
    if (signErr || !base.audio) {
      base.audioMintFailed = true;
    }
  }
  return base;
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
  // Same MFA rule as the identity/phone routes — /api is middleware-exempt.
  const authClient = await createServerClient();
  const { data: aal } = await authClient.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.currentLevel !== aal.nextLevel) { // fail CLOSED: an unreadable AAL is not a satisfied one
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

  // Candidate-level gates: permanent block, an already-passed test (the
  // page renders "already passed", but the API is the enforcement — a
  // passed candidate re-dealing attempts would farm the bank), and the
  // retake cooldown (previously only display + identity-hash enforced;
  // candidates without a verified identity had NO cooldown enforcement).
  const { data: candidateCheck } = await supabase
    .from("candidates")
    .select("permanently_blocked, english_attempts_exhausted, english_mc_score, english_comprehension_score, retake_available_at, admin_status, reapply_eligible_at")
    .eq("id", candidateId)
    .single();

  // A declined application does not get another assessment. Same gate as the
  // interview mint, same shape, one definition in lib/reviewOutcome.
  if (candidateCheck && applicationClosed(candidateCheck) && !candidateCheck.permanently_blocked) {
    return NextResponse.json({
      error: "This application is closed.",
      locked: true,
      applicationClosed: true,
      reapplyEligibleAt: candidateCheck.reapply_eligible_at ?? null,
    }, { status: 403 });
  }
  // Both stop a sitting, for different reasons: exhausted = no attempts left;
  // permanently_blocked = a person removed this account.
  if (candidateCheck?.permanently_blocked || candidateCheck?.english_attempts_exhausted) {
    return NextResponse.json({
      error: "No attempts remaining",
      locked: true,
      permanent: true,
      // Exhaustion closes the ASSESSMENT, not the account: the listing is
      // untouched (00220). "Permanently suspended" described the old
      // behaviour, where this also delisted the candidate.
      message: "You've used all your attempts at the English assessment. Your profile and listing are unaffected.",
    }, { status: 403 });
  }
  if (
    (candidateCheck?.english_mc_score ?? 0) >= 70 &&
    (candidateCheck?.english_comprehension_score ?? 0) >= 70
  ) {
    return NextResponse.json(
      { error: "Already passed", message: "This assessment is already passed — there is nothing to retake." },
      { status: 409 }
    );
  }
  if (
    candidateCheck?.retake_available_at &&
    new Date(candidateCheck.retake_available_at).getTime() > Date.now()
  ) {
    return NextResponse.json({
      error: "English assessment locked",
      locked: true,
      lockout_expires_at: candidateCheck.retake_available_at,
      message: "Your retake isn't open yet.",
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
      .select(OPEN_COLUMNS)
      .in("id", realIds);

    if (rows && rows.length === served.length) {
      const byId = new Map((rows as QuestionRow[]).map((r) => [r.id, r]));
      const questions = await Promise.all(
        served.map((s) => toClientQuestion(supabase, byId.get(s.qid)!, s))
      );

      // Resuming and the prompt audio would not mint. The item is already in
      // this attempt so it cannot be dropped — record it where GRADING can
      // see it, on the attempt's server_flags. Not in open_answers.flags: the
      // client overwrites that wholesale on submit, so a server note written
      // there would be gone by the time it mattered.
      const failedAudio = questions.filter((q) => q.audioMintFailed);
      if (failedAudio.length > 0) {
        const flags: Record<string, string> = {};
        for (const q of failedAudio) flags[q.id as string] = "audio_failed";
        await supabase
          .from("test_attempts")
          .update({ server_flags: { audio_failed: flags } })
          .eq("id", openAttempt.id);
        await supabase.from("vendor_failures").insert({
          app: "platform",
          vendor: "supabase_storage",
          operation: "listening.signedUrl",
          fatal: false,
          message: `Could not mint listening prompt audio on resume of attempt ${openAttempt.id}; part excluded from scoring.`,
          context: { attempt_id: openAttempt.id, candidate_id: candidateId },
        });
      }

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
  // ═══ PAYMENT GATE ═══
  // The English assessment is optional and paid. Placement matters: this is
  // AFTER the resume branch returned, so a candidate coming back to an open
  // attempt never reaches it.
  //
  // "Live purchase" is paid, unsettled and unrefunded — NOT "unclaimed". A
  // purchase claimed by an attempt still belongs to the candidate; treating a
  // claim as spent is what previously showed a mid-test candidate a paywall.
  const { data: entitlement } = await supabase
    .from("assessment_purchases")
    .select("id, attempt_id")
    .eq("candidate_id", candidateId)
    .eq("kind", "english")
    .eq("status", "paid")
    .is("consumed_at", null)
    .is("refunded_at", null)
    .maybeSingle();

  if (!entitlement) {
    return NextResponse.json(
      {
        error: "This assessment hasn't been paid for yet.",
        paymentRequired: true,
        kind: "english",
      },
      { status: 402 }
    );
  }

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

  // ── Open parts (step 8, Atlas 5-part spec) — vendor-gated honestly ──
  // read_aloud/listening/speaking need Deepgram + Anthropic; writing needs
  // Anthropic; listening additionally needs its generated prompt audio.
  // Whatever can't run simply isn't dealt, and the composite renormalizes
  // at grading — the candidate is only scored on what they were asked.
  const caps = assessmentCapabilities();
  const openRows: QuestionRow[] = [];
  const pickRandom = (rows: QuestionRow[] | null) =>
    rows && rows.length > 0 ? rows[Math.floor(Math.random() * rows.length)] : null;

  if (caps.spoken) {
    const [{ data: readRows }, { data: listenRows }, { data: speakRows }] = await Promise.all([
      supabase.from("english_test_questions").select(OPEN_COLUMNS).eq("section", "read_aloud").eq("active", true),
      supabase.from("english_test_questions").select(OPEN_COLUMNS).eq("section", "listening").eq("active", true).not("audio_url", "is", null),
      supabase.from("english_test_questions").select(OPEN_COLUMNS).eq("section", "speaking").eq("active", true),
    ]);
    for (const picked of [pickRandom(readRows as QuestionRow[]), pickRandom(listenRows as QuestionRow[]), pickRandom(speakRows as QuestionRow[])]) {
      if (!picked) continue;
      // Prove the listening audio can actually be delivered BEFORE committing
      // the item to the attempt. An item dealt with a dead URL is an
      // automatic zero the candidate cannot see coming, cannot report, and
      // did nothing to earn. Not dealing it costs them nothing: the composite
      // renormalizes over the parts that actually ran, exactly as it does
      // when the vendor gate turns the section off.
      if (picked.section === "listening" && picked.audio_url) {
        const { data: probe, error: probeErr } = await supabase.storage
          .from(RECORDINGS_BUCKET)
          .createSignedUrl(picked.audio_url, AUDIO_URL_TTL_SECONDS);
        if (probeErr || !probe?.signedUrl) {
          await supabase.from("vendor_failures").insert({
            app: "platform",
            vendor: "supabase_storage",
            operation: "listening.signedUrl",
            fatal: false,
            message: `Could not mint prompt audio for listening question ${picked.id}; item not dealt. ${probeErr?.message ?? "no url returned"}`,
            context: { question_id: picked.id, candidate_id: candidateId },
          });
          continue;
        }
      }
      openRows.push(picked);
    }
  }
  if (caps.writing) {
    const { data: writeRows } = await supabase
      .from("english_test_questions")
      .select(OPEN_COLUMNS)
      .eq("section", "writing")
      .eq("active", true);
    const picked = pickRandom(writeRows as QuestionRow[]);
    if (picked) openRows.push(picked);
  }

  const orderedRows = [...selectedGrammar, ...(compQuestions as QuestionRow[]), ...openRows];

  // Build the server-held record and the client payload together. Open
  // items have no options — their map is empty and their answer arrives as
  // text or a recording, not an index.
  const served: ServedQuestion[] = [];
  const pairRows = orderedRows.map((q) => {
    const options = (q.options as string[] | null) || [];
    const map = options.length > 0 ? shuffleArray(options.map((_, i) => i)) : [];
    const eph = randomUUID();
    const sv = { qid: q.id, eph, map };
    served.push(sv);
    return { q, sv };
  });

  // Grammar order is shuffled for display; comprehension stays after it in
  // display order; open parts run last in the fixed Atlas order
  // (read → listen → speak → write). Shuffle the pairs together so the
  // server record matches what the client sees.
  const OPEN_ORDER = ["read_aloud", "listening", "speaking", "writing"];
  const grammarPairs = shuffleArray(pairRows.filter((p) => p.q.section === "grammar"));
  const compPairs = pairRows.filter((p) => p.q.section === "comprehension");
  const openPairs = pairRows
    .filter((p) => OPEN_ORDER.includes(p.q.section))
    .sort((a, b) => OPEN_ORDER.indexOf(a.q.section) - OPEN_ORDER.indexOf(b.q.section));
  const finalPairs = [...grammarPairs, ...compPairs, ...openPairs];

  const expiresAt = new Date(
    Date.now() + (openPairs.length > 0 ? FULL_LIFETIME_MS : MC_ONLY_LIFETIME_MS)
  ).toISOString();

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

  // Attach the purchase to this attempt.
  //
  // Claiming, not spending: the money is only settled once the sitting is
  // graded or the clock runs out (see the submit route). Until then the
  // candidate still holds a live purchase, which is what lets them reload,
  // resume, and not be shown a paywall or a second Buy button mid-test.
  //
  // The order is deliberately biased toward the candidate: if anything above
  // had failed, they would still hold an unclaimed purchase. Claiming first
  // would mean a bug in question dealing costs them $5 and returns nothing.
  //
  // A null return means another tab claimed it for a different attempt in the
  // gap. The attempt is already dealt, so we let it stand rather than tearing
  // it down — one free sitting out of our own race is a better outcome than a
  // paying candidate staring at an error.
  const { data: claimedId } = await supabase.rpc("claim_assessment_entitlement", {
    p_candidate_id: candidateId,
    p_kind: "english",
    p_attempt_id: attempt.id,
  });

  if (!claimedId) {
    console.warn(
      `[test-questions] attempt ${attempt.id} dealt for candidate ${candidateId} but no entitlement was claimed (raced); allowing it to stand`
    );
  }

  const clientQuestions = await Promise.all(
    finalPairs.map((p) => toClientQuestion(supabase, p.q, p.sv))
  );

  return NextResponse.json({
    attemptId: attempt.id,
    expiresAt,
    passage: passageRow.passage_text,
    questions: clientQuestions,
  });
}
