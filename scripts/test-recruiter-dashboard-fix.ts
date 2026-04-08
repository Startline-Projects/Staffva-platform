/**
 * Test the recruiter dashboard fix:
 * 1. queue — candidates with AI done, not yet scheduled
 * 2. allAssigned — for candidateMap (message names)
 *
 * Run with: npx tsx scripts/test-recruiter-dashboard-fix.ts
 */
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  "https://mshnsbblwgcpwuxwuevp.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Get all recruiter profiles
  const { data: recruiters } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("role", "recruiter");

  console.log("\n=== Per-recruiter dashboard data ===\n");

  for (const r of recruiters || []) {
    // allAssigned (for candidateMap)
    const { data: allAssigned } = await admin
      .from("candidates")
      .select("id, display_name, full_name, profile_photo_url")
      .eq("assigned_recruiter", r.id);

    // queue (AI done, not scheduled)
    const { data: queue, error: qErr } = await admin
      .from("candidates")
      .select("id, display_name, full_name, role_category, ai_interview_completed_at, email")
      .eq("assigned_recruiter", r.id)
      .not("ai_interview_completed_at", "is", null)
      .eq("second_interview_status", "none")
      .order("ai_interview_completed_at", { ascending: true });

    // message threads
    const { data: msgs } = await admin
      .from("recruiter_messages")
      .select("candidate_id, sender_role, body, created_at, read_at")
      .eq("recruiter_id", r.id)
      .order("created_at", { ascending: false })
      .limit(50);

    const threadMap = new Map<string, { candidate_id: string; last_message: string; unread: number }>();
    for (const m of msgs || []) {
      if (!threadMap.has(m.candidate_id)) {
        threadMap.set(m.candidate_id, { candidate_id: m.candidate_id, last_message: m.body, unread: 0 });
      }
      if (m.sender_role === "candidate" && !m.read_at) {
        threadMap.get(m.candidate_id)!.unread++;
      }
    }

    // Build candidateMap
    const candidateMap = new Map<string, string>();
    for (const c of allAssigned || []) {
      candidateMap.set(c.id, c.display_name || c.full_name);
    }

    console.log(`Recruiter: ${r.full_name}`);
    console.log(`  allAssigned: ${allAssigned?.length ?? 0} candidates`);
    if (qErr) console.log(`  queue ERROR: ${qErr.message}`);
    else console.log(`  queue (need scheduling): ${queue?.length ?? 0} candidates`);

    for (const c of queue || []) {
      console.log(`    - ${c.display_name || c.full_name} (${c.role_category})`);
    }

    if (threadMap.size > 0) {
      console.log(`  message threads: ${threadMap.size}`);
      for (const [candidateId, thread] of threadMap) {
        const name = candidateMap.get(candidateId) || "UNKNOWN";
        const nameOk = name !== "UNKNOWN";
        console.log(`    ${nameOk ? "✓" : "✗"} ${name} — "${thread.last_message.slice(0, 40)}" (${thread.unread} unread)`);
      }
    }
    console.log();
  }
}

main().catch(console.error);
