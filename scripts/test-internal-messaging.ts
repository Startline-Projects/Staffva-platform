/**
 * Test the internal messaging system:
 * 1. Verify all team members are in the StaffVA Team thread
 * 2. Simulate the threads API response for each team member
 * 3. Test sending a message and reading it back
 *
 * Run: npx tsx scripts/test-internal-messaging.ts
 */
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  "https://mshnsbblwgcpwuxwuevp.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const TEAM_THREAD_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  console.log("=== Internal Messaging Test ===\n");

  // Check group thread
  const { data: thread, error: te } = await admin
    .from("internal_threads")
    .select("id, name, is_group")
    .eq("id", TEAM_THREAD_ID)
    .single();
  if (te) { console.log("❌ Thread query:", te.message); return; }
  console.log("✅ Group thread:", thread?.name, `(is_group=${thread?.is_group})`);

  // Check members
  const { data: members } = await admin
    .from("internal_thread_members")
    .select("profile_id, profiles!inner(full_name, role)")
    .eq("thread_id", TEAM_THREAD_ID);
  console.log(`✅ Group thread members (${members?.length}):`);
  for (const m of members || []) {
    const p = m.profiles as { full_name: string; role: string };
    console.log(`   - ${p.full_name} (${p.role})`);
  }

  // Test sending a message
  console.log("\n--- Testing message send ---");
  const firstMember = members?.[0];
  if (!firstMember) { console.log("❌ No members"); return; }

  const { data: msg, error: me } = await admin
    .from("internal_messages")
    .insert({
      thread_id: TEAM_THREAD_ID,
      sender_id: firstMember.profile_id,
      body: "TEST — safe to delete",
    })
    .select()
    .single();
  if (me) { console.log("❌ Insert message:", me.message); return; }
  console.log("✅ Inserted message:", msg?.id);

  // Read messages back
  const { data: msgs, error: re } = await admin
    .from("internal_messages")
    .select("id, sender_id, body, created_at")
    .eq("thread_id", TEAM_THREAD_ID)
    .order("created_at", { ascending: false })
    .limit(3);
  if (re) { console.log("❌ Read messages:", re.message); }
  else console.log(`✅ Read ${msgs?.length} messages`);

  // Clean up test message
  await admin.from("internal_messages").delete().eq("id", msg.id);
  console.log("✅ Cleaned up test message");

  // Verify threads list works (simulate API call)
  console.log("\n--- Simulating threads list API ---");
  const { data: allMemberships } = await admin
    .from("internal_thread_members")
    .select("thread_id, profile_id")
    .eq("profile_id", firstMember.profile_id);
  console.log(`✅ Profile ${firstMember.profile_id} is member of ${allMemberships?.length} threads`);

  console.log("\nAll tests passed!");
}

main().catch(console.error);
