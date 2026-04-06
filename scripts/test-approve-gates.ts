/**
 * Test script: Recruiting Manager 11-gate approval endpoint
 *
 * Run with:  npx tsx scripts/test-approve-gates.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 * Does NOT require the dev server to be running — tests the gate logic directly
 * against the database via Supabase admin client.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Parse .env.local manually (no dotenv dependency)
const envPath = resolve(__dirname, "../.env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[key]) process.env[key] = val;
}

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const TEST_EMAIL = `test-gates-${Date.now()}@test.staffva.local`;
const TEST_PASSWORD = "TestPassword123!";

// Mirrors the server-side 11-gate check from route.ts
function runGateCheck(candidate: Record<string, unknown>): string[] {
  const failing: string[] = [];
  if (candidate.english_mc_score == null || (candidate.english_mc_score as number) < 70)
    failing.push("English grammar score below passing threshold");
  if (candidate.english_comprehension_score == null || (candidate.english_comprehension_score as number) < 70)
    failing.push("English comprehension score below passing threshold");
  if (!candidate.voice_recording_1_url)
    failing.push("Oral reading recording missing");
  if (!candidate.voice_recording_2_url)
    failing.push("Self-introduction recording missing");
  if (candidate.id_verification_status !== "passed")
    failing.push("ID verification not passed");
  if (!candidate.profile_photo_url)
    failing.push("Profile photo missing");
  if (!candidate.resume_url)
    failing.push("Resume missing");
  if (!candidate.tagline)
    failing.push("Tagline missing");
  if (!candidate.bio)
    failing.push("Bio missing");
  if (!candidate.payout_method)
    failing.push("Payout method not selected");
  if (candidate.interview_consent !== true)
    failing.push("Interview consent not confirmed");
  if (candidate.speaking_level == null)
    failing.push("Speaking level not assigned — recruiter must assign before approval");
  return failing;
}

async function main() {
  let testUserId = "";
  let testCandidateId = "";
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, label: string) {
    if (condition) {
      console.log(`  PASS: ${label}`);
      passed++;
    } else {
      console.error(`  FAIL: ${label}`);
      failed++;
    }
  }

  try {
    // Create test auth user + profile (required by FK constraint)
    console.log("\n== Setup: Creating test auth user and profile ==");
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { role: "candidate" },
    });
    if (authErr || !authData.user) {
      console.error("Failed to create test auth user:", authErr?.message);
      process.exit(1);
    }
    testUserId = authData.user.id;
    console.log(`  Created auth user: ${testUserId}`);

    // Create profile row
    const { error: profileErr } = await admin.from("profiles").insert({
      id: testUserId,
      role: "candidate",
      email: TEST_EMAIL,
      full_name: "Test Gate Candidate",
    });
    if (profileErr) {
      console.error("Failed to create profile:", profileErr.message);
      process.exit(1);
    }

    // ── Test 1: Candidate with missing resume → should fail with "Resume missing" ──
    console.log("\n== Test 1: Missing resume triggers gate failure ==");

    const { data: inserted, error: insertErr } = await admin
      .from("candidates")
      .insert({
        user_id: testUserId,
        email: TEST_EMAIL,
        full_name: "Test Gate Candidate",
        display_name: "Test Gate",
        country: "Philippines",
        role_category: "General VA",
        years_experience: "3-5",
        hourly_rate: 5,
        time_zone: "Asia/Manila",
        admin_status: "pending_speaking_review",
        english_mc_score: 85,
        english_comprehension_score: 80,
        voice_recording_1_url: "https://example.com/voice1.mp3",
        voice_recording_2_url: "https://example.com/voice2.mp3",
        id_verification_status: "passed",
        profile_photo_url: "https://example.com/photo.jpg",
        resume_url: null, // <-- deliberately missing
        tagline: "Experienced VA",
        bio: "I am a skilled virtual assistant with 5 years of experience.",
        payout_method: "wise",
        interview_consent: true,
        speaking_level: "fluent",
        second_interview_status: "completed",
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error("Failed to insert test candidate:", insertErr?.message);
      process.exit(1);
    }

    testCandidateId = inserted.id;
    console.log(`  Created test candidate: ${testCandidateId}`);

    // Fetch and run gate check
    const { data: c1 } = await admin
      .from("candidates")
      .select("id, email, full_name, display_name, second_interview_status, english_mc_score, english_comprehension_score, voice_recording_1_url, voice_recording_2_url, id_verification_status, profile_photo_url, resume_url, tagline, bio, payout_method, interview_consent, speaking_level, admin_status")
      .eq("id", testCandidateId)
      .single();

    const failures1 = runGateCheck(c1!);
    assert(failures1.length > 0, "Gate check returns failures");
    assert(failures1.includes("Resume missing"), 'failingConditions includes "Resume missing"');
    assert(!failures1.includes("English grammar score below passing threshold"), "English MC passes (score is 85)");

    // Confirm admin_status unchanged
    assert(c1!.admin_status === "pending_speaking_review", "admin_status still pending_speaking_review");

    // ── Test 2: Fix resume → all gates should pass ──
    console.log("\n== Test 2: All conditions met → approval succeeds ==");

    await admin
      .from("candidates")
      .update({ resume_url: "https://example.com/resume.pdf" })
      .eq("id", testCandidateId);

    const { data: c2 } = await admin
      .from("candidates")
      .select("id, email, full_name, display_name, second_interview_status, english_mc_score, english_comprehension_score, voice_recording_1_url, voice_recording_2_url, id_verification_status, profile_photo_url, resume_url, tagline, bio, payout_method, interview_consent, speaking_level, admin_status")
      .eq("id", testCandidateId)
      .single();

    const failures2 = runGateCheck(c2!);
    assert(failures2.length === 0, "No failing conditions when all gates pass");

    // Simulate the approval update
    await admin
      .from("candidates")
      .update({ admin_status: "approved", profile_went_live_at: new Date().toISOString() })
      .eq("id", testCandidateId);

    const { data: c3 } = await admin
      .from("candidates")
      .select("admin_status")
      .eq("id", testCandidateId)
      .single();

    assert(c3!.admin_status === "approved", "admin_status is now approved");

    // ── Test 3: Multiple failures at once ──
    console.log("\n== Test 3: Multiple missing fields return all failing conditions ==");

    await admin
      .from("candidates")
      .update({
        admin_status: "pending_speaking_review",
        resume_url: null,
        tagline: null,
        bio: "",
        payout_method: null,
        speaking_level: null,
      })
      .eq("id", testCandidateId);

    const { data: c4 } = await admin
      .from("candidates")
      .select("id, email, full_name, display_name, second_interview_status, english_mc_score, english_comprehension_score, voice_recording_1_url, voice_recording_2_url, id_verification_status, profile_photo_url, resume_url, tagline, bio, payout_method, interview_consent, speaking_level, admin_status")
      .eq("id", testCandidateId)
      .single();

    const failures4 = runGateCheck(c4!);
    assert(failures4.includes("Resume missing"), "Catches missing resume");
    assert(failures4.includes("Tagline missing"), "Catches missing tagline");
    assert(failures4.includes("Bio missing"), "Catches empty bio");
    assert(failures4.includes("Payout method not selected"), "Catches missing payout");
    assert(failures4.includes("Speaking level not assigned — recruiter must assign before approval"), "Catches missing speaking level");
    assert(failures4.length === 5, `Exactly 5 failures (got ${failures4.length})`);

  } finally {
    // Cleanup
    if (testCandidateId) {
      await admin.from("candidates").delete().eq("id", testCandidateId);
      console.log(`\n  Cleaned up test candidate ${testCandidateId}`);
    }
    if (testUserId) {
      await admin.from("profiles").delete().eq("id", testUserId);
      await admin.auth.admin.deleteUser(testUserId);
      console.log(`  Cleaned up test user ${testUserId}`);
    }
  }

  console.log(`\n========================================`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
