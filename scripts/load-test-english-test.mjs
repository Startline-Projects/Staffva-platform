/**
 * Load test for English test hardening: 500 concurrent candidates.
 * Tests: application_progress DB writes, concurrent upserts,
 * connection pool limits, and upload queue simulation.
 * Run: node scripts/load-test-english-test.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mshnsbblwgcpwuxwuevp.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaG5zYmJsd2djcHd1eHd1ZXZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDEzMjYwOSwiZXhwIjoyMDg5NzA4NjA5fQ.VoSXw8GzKY0VqOkEjA_YJ-fYoaRMwi9yoO9shOxa3qY";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const TEST_COUNT = 500;

async function runTest() {
  console.log(`\n📝 English Test Hardening Load Test: ${TEST_COUNT} concurrent candidates\n`);

  // Get real candidate IDs
  const { data: candidates } = await supabase
    .from("candidates")
    .select("id")
    .limit(50);

  if (!candidates || candidates.length === 0) {
    console.log("❌ No candidates found. Need at least 1 candidate.");
    return;
  }

  console.log(`📋 Using ${candidates.length} candidate IDs (rotating)\n`);

  // ── TEST 1: Concurrent application_progress upserts ──
  console.log("═══ TEST 1: Concurrent DB Progress Writes ═══");
  const upsertStart = Date.now();

  const upsertPromises = Array.from({ length: TEST_COUNT }, (_, i) => {
    const candidateId = candidates[i % candidates.length].id;
    return supabase
      .from("application_progress")
      .upsert(
        {
          candidate_id: candidateId,
          section: i % 2 === 0 ? "grammar" : "comprehension",
          question_index: i % 100,
          answers: { [`q${i}`]: Math.floor(Math.random() * 4) },
          timer_remaining: 900 - i,
          is_mobile: i % 5 === 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "candidate_id" }
      )
      .then(({ error }) => ({ error, index: i }));
  });

  const upsertResults = await Promise.all(upsertPromises);
  const upsertTime = Date.now() - upsertStart;
  const upsertSuccess = upsertResults.filter((r) => !r.error).length;
  const upsertFailed = upsertResults.filter((r) => r.error);

  console.log(`   Successful: ${upsertSuccess}/${TEST_COUNT}`);
  console.log(`   Failed: ${upsertFailed.length}`);
  console.log(`   Time: ${upsertTime}ms (${(upsertTime / TEST_COUNT).toFixed(1)}ms avg)`);
  if (upsertFailed.length > 0) {
    console.log(`   First error: ${upsertFailed[0].error?.message}`);
  }

  // ── TEST 2: Concurrent reads (simulating 500 page refreshes) ──
  console.log("\n═══ TEST 2: Concurrent DB Progress Reads ═══");
  const readStart = Date.now();

  const readPromises = Array.from({ length: TEST_COUNT }, (_, i) => {
    const candidateId = candidates[i % candidates.length].id;
    return supabase
      .from("application_progress")
      .select("*")
      .eq("candidate_id", candidateId)
      .single()
      .then(({ data, error }) => ({ data, error, index: i }));
  });

  const readResults = await Promise.all(readPromises);
  const readTime = Date.now() - readStart;
  const readSuccess = readResults.filter((r) => r.data && !r.error).length;
  const readFailed = readResults.filter((r) => r.error);

  console.log(`   Successful: ${readSuccess}/${TEST_COUNT}`);
  console.log(`   Failed: ${readFailed.length}`);
  console.log(`   Time: ${readTime}ms (${(readTime / TEST_COUNT).toFixed(1)}ms avg)`);

  // ── TEST 3: Simulated upload queue (concurrent storage operations) ──
  console.log("\n═══ TEST 3: Upload Queue Simulation ═══");
  const uploadCount = 100; // Simulate 100 concurrent audio uploads
  const uploadStart = Date.now();

  // Create small test blobs (1KB each)
  const testBlob = new Blob([new Uint8Array(1024)], { type: "audio/webm" });

  const uploadPromises = Array.from({ length: uploadCount }, (_, i) => {
    const candidateId = candidates[i % candidates.length].id;
    const fileName = `test-uploads/${candidateId}/load-test-${i}-${Date.now()}.webm`;

    return supabase.storage
      .from("voice-recordings")
      .upload(fileName, testBlob, { upsert: true })
      .then(({ error }) => ({ error, fileName, index: i }));
  });

  const uploadResults = await Promise.all(uploadPromises);
  const uploadTime = Date.now() - uploadStart;
  const uploadSuccess = uploadResults.filter((r) => !r.error).length;
  const uploadFailed = uploadResults.filter((r) => r.error);

  console.log(`   Concurrent uploads: ${uploadCount}`);
  console.log(`   Successful: ${uploadSuccess}/${uploadCount}`);
  console.log(`   Failed: ${uploadFailed.length}`);
  console.log(`   Time: ${uploadTime}ms (${(uploadTime / uploadCount).toFixed(1)}ms avg)`);
  if (uploadFailed.length > 0) {
    console.log(`   First error: ${uploadFailed[0].error?.message}`);
  }

  // ── TEST 4: Connection pool stress (rapid sequential queries) ──
  console.log("\n═══ TEST 4: Connection Pool Stress ═══");
  const poolStart = Date.now();
  let poolSuccess = 0;
  let poolFailed = 0;

  // Fire 500 rapid queries
  const poolPromises = Array.from({ length: TEST_COUNT }, (_, i) => {
    return supabase
      .from("candidates")
      .select("id, display_name")
      .limit(1)
      .then(({ error }) => {
        if (error) poolFailed++;
        else poolSuccess++;
      });
  });

  await Promise.all(poolPromises);
  const poolTime = Date.now() - poolStart;

  console.log(`   Rapid queries: ${TEST_COUNT}`);
  console.log(`   Successful: ${poolSuccess}`);
  console.log(`   Failed: ${poolFailed}`);
  console.log(`   Time: ${poolTime}ms (${(poolTime / TEST_COUNT).toFixed(1)}ms avg)`);

  // ── Cleanup ──
  console.log("\n🧹 Cleaning up...");

  // Clean up progress records
  for (const c of candidates) {
    await supabase
      .from("application_progress")
      .delete()
      .eq("candidate_id", c.id);
  }

  // Clean up test uploads
  const { data: testFiles } = await supabase.storage
    .from("voice-recordings")
    .list("test-uploads", { limit: 1000 });

  if (testFiles && testFiles.length > 0) {
    // List subdirectories and delete
    for (const folder of testFiles) {
      const { data: files } = await supabase.storage
        .from("voice-recordings")
        .list(`test-uploads/${folder.name}`, { limit: 1000 });
      if (files && files.length > 0) {
        const filePaths = files.map((f) => `test-uploads/${folder.name}/${f.name}`);
        await supabase.storage
          .from("voice-recordings")
          .remove(filePaths);
      }
    }
  }

  console.log("   ✅ Cleaned up");

  // ── Summary ──
  const totalTime = Date.now() - upsertStart;
  console.log(`\n⏱  Total test time: ${totalTime}ms`);

  const allPassed =
    upsertSuccess === TEST_COUNT &&
    readSuccess >= TEST_COUNT * 0.95 && // Allow 5% read misses (concurrent upserts may not have settled)
    uploadSuccess >= uploadCount * 0.9 && // Allow 10% upload failures under load
    poolFailed === 0;

  if (allPassed) {
    console.log(`\n✅ ENGLISH TEST HARDENING LOAD TEST PASSED`);
    console.log(`   ✓ ${upsertSuccess}/${TEST_COUNT} progress writes (${(upsertTime / TEST_COUNT).toFixed(1)}ms avg)`);
    console.log(`   ✓ ${readSuccess}/${TEST_COUNT} progress reads (${(readTime / TEST_COUNT).toFixed(1)}ms avg)`);
    console.log(`   ✓ ${uploadSuccess}/${uploadCount} concurrent uploads (${(uploadTime / uploadCount).toFixed(1)}ms avg)`);
    console.log(`   ✓ ${poolSuccess}/${TEST_COUNT} connection pool queries (${(poolTime / TEST_COUNT).toFixed(1)}ms avg)`);
    console.log(`   ✓ No connection pool exhaustion detected`);
  } else {
    console.log(`\n⚠ ENGLISH TEST LOAD TEST COMPLETED WITH WARNINGS`);
    if (upsertSuccess !== TEST_COUNT) console.log(`   ⚠ Progress writes: ${upsertSuccess}/${TEST_COUNT}`);
    if (readSuccess < TEST_COUNT * 0.95) console.log(`   ⚠ Progress reads: ${readSuccess}/${TEST_COUNT} (< 95%)`);
    if (uploadSuccess < uploadCount * 0.9) console.log(`   ⚠ Uploads: ${uploadSuccess}/${uploadCount} (< 90%)`);
    if (poolFailed > 0) console.log(`   ⚠ Pool failures: ${poolFailed}/${TEST_COUNT}`);
  }
}

runTest().catch(console.error);
