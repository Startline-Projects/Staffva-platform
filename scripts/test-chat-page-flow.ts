/**
 * Simulate exactly what the fixed recruiter-chat page does:
 * 1. Call /api/candidate/recruiter-profile logic (service role)
 * 2. Call /api/recruiter-messages GET logic
 * 3. Call /api/recruiter-messages POST logic (insert + retrieve)
 *
 * Run with: npx tsx scripts/test-chat-page-flow.ts
 */
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  "https://mshnsbblwgcpwuxwuevp.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testForCandidate(candidateUserId: string, candidateName: string) {
  console.log(`\n--- ${candidateName} ---`);

  // Step 1: recruiter-profile API logic
  const { data: candidate } = await admin
    .from("candidates")
    .select("id, assigned_recruiter")
    .eq("user_id", candidateUserId)
    .single();

  if (!candidate?.assigned_recruiter) {
    console.log("FAIL: no assigned_recruiter");
    return;
  }

  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate.assigned_recruiter);
  let profile = null;
  if (isUUID) {
    const { data } = await admin.from("profiles").select("id, full_name, calendar_link").eq("id", candidate.assigned_recruiter).single();
    profile = data;
  }
  if (!profile) { console.log("FAIL: recruiter profile not found"); return; }
  console.log(`✓ Recruiter profile: ${profile.full_name}`);

  // Step 2: GET messages
  const { data: msgs, error: msgsErr } = await admin
    .from("recruiter_messages")
    .select("id, sender_role, body, created_at")
    .eq("recruiter_id", candidate.assigned_recruiter)
    .eq("candidate_id", candidate.id)
    .order("created_at", { ascending: true });
  if (msgsErr) { console.log("FAIL GET messages:", msgsErr.message); return; }
  console.log(`✓ GET messages: ${msgs?.length ?? 0} existing messages`);

  // Step 3: POST a test message
  const { data: newMsg, error: insertErr } = await admin
    .from("recruiter_messages")
    .insert({
      recruiter_id: candidate.assigned_recruiter,
      candidate_id: candidate.id,
      sender_role: "candidate",
      body: "TEST — safe to delete",
    })
    .select()
    .single();
  if (insertErr) { console.log("FAIL POST message:", insertErr.message, insertErr.details); return; }
  console.log(`✓ POST message: inserted id=${newMsg.id}`);

  // Clean up
  await admin.from("recruiter_messages").delete().eq("id", newMsg.id);
  console.log(`✓ Cleanup done`);
}

async function main() {
  console.log("=== Chat page flow test ===");

  const { data: candidates } = await admin
    .from("candidates")
    .select("user_id, full_name")
    .not("ai_interview_completed_at", "is", null)
    .not("assigned_recruiter", "is", null)
    .limit(5);

  for (const c of candidates || []) {
    await testForCandidate(c.user_id, c.full_name);
  }

  console.log("\nDone.");
}

main().catch(console.error);
