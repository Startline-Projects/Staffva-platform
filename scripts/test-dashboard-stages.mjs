/**
 * Dashboard stage message test.
 * Run: node scripts/test-dashboard-stages.mjs
 */

// Simulates the dashboard stage detection logic
function getStage(c, ai) {
  const testSubmitted = (c.english_mc_score ?? 0) > 0;
  const idConsentGiven = !!c.id_verification_consent;
  const idVerified = c.id_verification_status === "passed";
  const idManualReview = c.id_verification_status === "manual_review";
  const aiDone = !!ai && ai.status === "completed" && ai.passed;
  const recruiterScheduled = ai?.second_interview_status === "scheduled";
  const recruiterDone = ai?.second_interview_status === "completed";
  const spokenScored = (c.spoken_english_score ?? 0) > 0;
  const profileUnderReview = recruiterDone && spokenScored && c.admin_status !== "approved" && c.admin_status !== "changes_requested";
  const changesRequested = c.admin_status === "changes_requested";
  const profileLive = c.admin_status === "approved";

  if (!testSubmitted) return "Stage 1: Application received, test not started";
  if (testSubmitted && !idConsentGiven && !idVerified) return "Stage 2: Test submitted, awaiting ID";
  if (idManualReview && !idVerified) return "Stage 3: ID pending manual review";
  if (idVerified && !aiDone) return "Stage 4: ID verified, AI not started";
  if (aiDone && !recruiterScheduled && !recruiterDone) return "Stage 5: AI done, awaiting recruiter";
  if (recruiterScheduled && !recruiterDone) return "Stage 6: Recruiter scheduled";
  if (profileUnderReview) return "Stage 7: Profile under review";
  if (changesRequested) return "Stage 8: Changes requested";
  if (profileLive) return "Stage 9: Profile live";
  if (recruiterDone && !spokenScored) return "Stage 7 (pre): Recruiter done, spoken not scored";
  return "Fallback";
}

const tests = [
  { desc: "Stage 1", c: { english_mc_score: null, id_verification_consent: false, id_verification_status: "pending", admin_status: "pending_speaking_review", spoken_english_score: null }, ai: null, expect: "Stage 1" },
  { desc: "Stage 2", c: { english_mc_score: 85, id_verification_consent: false, id_verification_status: "pending", admin_status: "pending_speaking_review", spoken_english_score: null }, ai: null, expect: "Stage 2" },
  { desc: "Stage 3", c: { english_mc_score: 85, id_verification_consent: true, id_verification_status: "manual_review", admin_status: "pending_speaking_review", spoken_english_score: null }, ai: null, expect: "Stage 3" },
  { desc: "Stage 4", c: { english_mc_score: 85, id_verification_consent: true, id_verification_status: "passed", admin_status: "pending_speaking_review", spoken_english_score: null }, ai: null, expect: "Stage 4" },
  { desc: "Stage 5", c: { english_mc_score: 85, id_verification_consent: true, id_verification_status: "passed", admin_status: "pending_speaking_review", spoken_english_score: null }, ai: { status: "completed", passed: true, second_interview_status: null }, expect: "Stage 5" },
  { desc: "Stage 6", c: { english_mc_score: 85, id_verification_consent: true, id_verification_status: "passed", admin_status: "pending_speaking_review", spoken_english_score: null }, ai: { status: "completed", passed: true, second_interview_status: "scheduled" }, expect: "Stage 6" },
  { desc: "Stage 7", c: { english_mc_score: 85, id_verification_consent: true, id_verification_status: "passed", admin_status: "pending_speaking_review", spoken_english_score: 80 }, ai: { status: "completed", passed: true, second_interview_status: "completed" }, expect: "Stage 7" },
  { desc: "Stage 8", c: { english_mc_score: 85, id_verification_consent: true, id_verification_status: "passed", admin_status: "changes_requested", spoken_english_score: 80 }, ai: { status: "completed", passed: true, second_interview_status: "completed" }, expect: "Stage 8" },
  { desc: "Stage 9", c: { english_mc_score: 85, id_verification_consent: true, id_verification_status: "passed", admin_status: "approved", spoken_english_score: 80 }, ai: { status: "completed", passed: true, second_interview_status: "completed" }, expect: "Stage 9" },
  { desc: "Under review must NOT fire before spoken scored", c: { english_mc_score: 85, id_verification_consent: true, id_verification_status: "passed", admin_status: "pending_speaking_review", spoken_english_score: null }, ai: { status: "completed", passed: true, second_interview_status: "completed" }, expect: "Stage 7 (pre)" },
];

console.log("\n📋 Dashboard Stage Messages Test\n");
let passed = 0;
for (const t of tests) {
  const result = getStage(t.c, t.ai);
  const ok = result.includes(t.expect);
  console.log(`  ${ok ? "✓" : "✗"} ${t.desc}: ${result}`);
  if (ok) passed++;
}
console.log(`\n${passed}/${tests.length} tests passed${passed === tests.length ? " ✅" : " ❌"}`);
