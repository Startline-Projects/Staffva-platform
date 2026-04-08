/**
 * Test the recruiter-chat page fix: confirm that the profiles query
 * (without avatar_url) works for candidates with an assigned recruiter.
 * Run with: npx tsx scripts/test-recruiter-chat-fix.ts
 */
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  "https://mshnsbblwgcpwuxwuevp.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Get post-AI-interview candidates with an assigned recruiter
  const { data: candidates } = await admin
    .from("candidates")
    .select("id, full_name, assigned_recruiter")
    .not("ai_interview_completed_at", "is", null)
    .not("assigned_recruiter", "is", null)
    .limit(10);

  console.log("\n=== Recruiter chat profile lookup (no avatar_url) ===\n");

  let pass = 0, fail = 0;
  for (const c of candidates || []) {
    // Simulate exactly what the fixed chat page does
    const { data: rp, error } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", c.assigned_recruiter)
      .single();

    if (error) {
      console.log(`✗ ${c.full_name}: query error — ${error.message}`);
      fail++;
    } else if (rp) {
      console.log(`✓ ${c.full_name}: recruiter = "${rp.full_name}"`);
      pass++;
    } else {
      console.log(`✗ ${c.full_name}: no profile found for UUID ${c.assigned_recruiter}`);
      fail++;
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
}

main().catch(console.error);
