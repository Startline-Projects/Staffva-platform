/**
 * The grader's part-name matching, exercised directly.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/test-open-part-matching.ts
 *
 * WHY THIS EXISTS: an English attempt was parked as "grading_failed" twice
 * with "Grader omitted part writing" while the candidate's 104-word answer sat
 * in the database perfectly intact. The part name is the MODEL'S free text and
 * was being looked up by exact match, so a different capitalisation was enough
 * to lose a whole sitting — and the model's reply was discarded, leaving
 * nothing to diagnose from.
 *
 * These rules decide whether a candidate gets a score or is told scoring
 * failed, so they are worth being able to run without a network call.
 */
import { matchOpenPartScores, type OpenPartInput } from "@/lib/assessment";

const writing: OpenPartInput = { part: "writing", prompt: "p", response: "a".repeat(40) };
const speaking: OpenPartInput = { part: "speaking", prompt: "p", response: "b" };

let pass = 0, fail = 0;
function check(name: string, fn: () => boolean) {
  let ok = false, err = "";
  try { ok = fn(); } catch (e) { err = (e as Error).message; }
  if (ok) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (err ? "  -> " + err : "")); }
}

// 1. The production failure: one part requested, model used a different label.
check('single part, model says "Writing" (capitalised)', () =>
  matchOpenPartScores([writing], [{ part: "Writing", score: 72, note: "n" }]).writing.score === 72);

check('single part, model says " writing " (padded)', () =>
  matchOpenPartScores([writing], [{ part: " writing ", score: 65, note: "" }]).writing.score === 65);

check('single part, model invents a label entirely', () =>
  matchOpenPartScores([writing], [{ part: "written_response", score: 80, note: "" }]).writing.score === 80);

// 2. Exact match still works.
check("exact name still matches", () =>
  matchOpenPartScores([writing], [{ part: "writing", score: 90, note: "" }]).writing.score === 90);

// 3. Ambiguity is NOT guessed at.
check("two parts, one missing -> still throws", () => {
  try {
    matchOpenPartScores([writing, speaking], [{ part: "writing", score: 70, note: "" }]);
    return false;
  } catch (e) {
    return (e as Error).message.includes("omitted part speaking");
  }
});

check("the error now names what DID come back", () => {
  try {
    matchOpenPartScores([writing, speaking], [{ part: "wrytting", score: 70, note: "" }]);
    return false;
  } catch (e) {
    return (e as Error).message.includes("returned: wrytting");
  }
});

// 4. Out-of-range / malformed scores are still rejected.
check("score above 100 is not accepted", () => {
  try { matchOpenPartScores([writing], [{ part: "writing", score: 140, note: "" }]); return false; }
  catch { return true; }
});

check("two parts, both present but re-cased", () => {
  const r = matchOpenPartScores([writing, speaking], [
    { part: "WRITING", score: 70, note: "" },
    { part: "Speaking", score: 60, note: "" },
  ]);
  return r.writing.score === 70 && r.speaking.score === 60;
});

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
