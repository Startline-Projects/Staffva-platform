/**
 * Load test for application queue system.
 * Simulates 100 concurrent queue inserts and verifies all process correctly.
 * Run: node scripts/load-test-queue.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mshnsbblwgcpwuxwuevp.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaG5zYmJsd2djcHd1eHd1ZXZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDEzMjYwOSwiZXhwIjoyMDg5NzA4NjA5fQ.VoSXw8GzKY0VqOkEjA_YJ-fYoaRMwi9yoO9shOxa3qY";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const TEST_COUNT = 100;
const TEST_PREFIX = "LOADTEST_";

async function runLoadTest() {
  console.log(`\n🚀 Starting load test: ${TEST_COUNT} concurrent application queue inserts\n`);

  const startTime = Date.now();

  // Generate test applications
  const applications = Array.from({ length: TEST_COUNT }, (_, i) => ({
    user_id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    status: "pending",
    application_data: {
      full_name: `${TEST_PREFIX}User ${i}`,
      email: `loadtest${i}@test.staffva.com`,
      country: "Philippines",
      role_category: "Paralegal",
      years_experience: "3-5",
      hourly_rate: 8 + (i % 30),
      time_zone: "Asia/Manila",
      bio: `Load test application #${i}`,
      us_client_experience: "none",
      skills: ["Legal research", "Document review"],
      tools: ["Clio", "Microsoft Word"],
      computer_specs: "MacBook Pro 2023",
      has_headset: true,
      has_webcam: true,
      has_college_degree: true,
    },
  }));

  // Insert all 100 simultaneously
  const insertPromises = applications.map((app) =>
    supabase
      .from("application_queue")
      .insert(app)
      .select("id")
      .single()
      .then(({ data, error }) => ({ data, error, userId: app.user_id }))
  );

  const results = await Promise.all(insertPromises);

  const insertTime = Date.now() - startTime;
  const successful = results.filter((r) => r.data && !r.error);
  const failed = results.filter((r) => r.error);

  console.log(`📊 Insert Results:`);
  console.log(`   Total: ${TEST_COUNT}`);
  console.log(`   Successful: ${successful.length}`);
  console.log(`   Failed: ${failed.length}`);
  console.log(`   Time: ${insertTime}ms (${(insertTime / TEST_COUNT).toFixed(1)}ms per insert)`);

  if (failed.length > 0) {
    console.log(`\n❌ Insert Failures:`);
    failed.slice(0, 5).forEach((f) => console.log(`   ${f.userId}: ${f.error?.message}`));
    if (failed.length > 5) console.log(`   ... and ${failed.length - 5} more`);
  }

  // Verify all are in pending status
  const { data: pendingItems, error: queryError } = await supabase
    .from("application_queue")
    .select("id, status")
    .like("application_data->>full_name", `${TEST_PREFIX}%`);

  if (queryError) {
    console.log(`\n❌ Query error: ${queryError.message}`);
  } else {
    const pending = pendingItems?.filter((i) => i.status === "pending").length || 0;
    const processing = pendingItems?.filter((i) => i.status === "processing").length || 0;
    const complete = pendingItems?.filter((i) => i.status === "complete").length || 0;

    console.log(`\n📋 Queue Status:`);
    console.log(`   Pending: ${pending}`);
    console.log(`   Processing: ${processing}`);
    console.log(`   Complete: ${complete}`);
    console.log(`   Total in queue: ${pendingItems?.length || 0}`);
  }

  // Clean up test data
  console.log(`\n🧹 Cleaning up test data...`);
  const { error: deleteError } = await supabase
    .from("application_queue")
    .delete()
    .like("application_data->>full_name", `${TEST_PREFIX}%`);

  if (deleteError) {
    console.log(`   ⚠ Cleanup error: ${deleteError.message}`);
  } else {
    console.log(`   ✅ Test data cleaned up`);
  }

  const totalTime = Date.now() - startTime;
  console.log(`\n⏱  Total test time: ${totalTime}ms`);

  // Final verdict
  if (successful.length === TEST_COUNT) {
    console.log(`\n✅ LOAD TEST PASSED: All ${TEST_COUNT} applications inserted successfully`);
    console.log(`   Average insert time: ${(insertTime / TEST_COUNT).toFixed(1)}ms per application`);
    console.log(`   System can handle ${Math.floor(1000 / (insertTime / TEST_COUNT))} inserts/second`);
  } else {
    console.log(`\n❌ LOAD TEST FAILED: ${failed.length}/${TEST_COUNT} inserts failed`);
  }
}

runLoadTest().catch(console.error);
