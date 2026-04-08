/**
 * Diagnose recruiter messaging failures.
 * Run with: npx tsx scripts/test-recruiter-messaging.ts
 */
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  "https://mshnsbblwgcpwuxwuevp.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log("\n=== 1. Check candidates with assigned_recruiter ===");
  const { data: candidates } = await admin
    .from("candidates")
    .select("id, full_name, user_id, assigned_recruiter")
    .not("assigned_recruiter", "is", null)
    .not("ai_interview_completed_at", "is", null)
    .limit(5);
  console.table(candidates);

  console.log("\n=== 2. Check auth user metadata (role) for these candidates ===");
  for (const c of candidates || []) {
    const { data: { user } } = await admin.auth.admin.getUserById(c.user_id);
    console.log(`${c.full_name}: user_metadata.role = "${user?.user_metadata?.role}", app_metadata.role = "${user?.app_metadata?.role}"`);
  }

  console.log("\n=== 3. Test message insert with service role ===");
  const testCandidate = candidates?.[0];
  if (!testCandidate) { console.log("No candidate found"); return; }

  const { data: msg, error: insertErr } = await admin
    .from("recruiter_messages")
    .insert({
      recruiter_id: testCandidate.assigned_recruiter,
      candidate_id: testCandidate.id,
      sender_role: "candidate",
      body: "TEST MESSAGE — safe to delete",
    })
    .select()
    .single();

  if (insertErr) {
    console.error("Insert FAILED:", insertErr.message, insertErr.details, insertErr.hint);
  } else {
    console.log("Insert OK:", msg);
    // Clean up
    await admin.from("recruiter_messages").delete().eq("id", msg.id);
    console.log("Test message cleaned up.");
  }

  console.log("\n=== 4. Check recruiter_messages table RLS policies ===");
  const { data: policies, error: polErr } = await admin
    .rpc("pg_policies_for_table", { table_name: "recruiter_messages" })
    .select("*");
  if (polErr) {
    // RPC likely doesn't exist, skip
    console.log("(RPC not available — skipping policy check)");
  } else {
    console.table(policies);
  }

  console.log("\n=== 5. Existing messages in recruiter_messages ===");
  const { data: msgs, error: msgsErr } = await admin
    .from("recruiter_messages")
    .select("*")
    .limit(5);
  if (msgsErr) console.error("Error:", msgsErr.message);
  else console.table(msgs);
}

main().catch(console.error);
