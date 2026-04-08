/**
 * Debug script: diagnose why candidates are not seeing their recruiter on the dashboard.
 * Run with: npx tsx scripts/debug-recruiter-assignment.ts
 */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mshnsbblwgcpwuxwuevp.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log("\n=== 1. Sample of candidates with assigned_recruiter set ===");
  const { data: assigned, error: assignedErr } = await supabase
    .from("candidates")
    .select("id, full_name, role_category, assigned_recruiter, assignment_pending_review, ai_interview_completed_at")
    .not("assigned_recruiter", "is", null)
    .limit(10);

  if (assignedErr) console.error("Error:", assignedErr.message);
  else console.table(assigned);

  console.log("\n=== 2. Distinct assigned_recruiter values ===");
  const { data: distinct } = await supabase
    .from("candidates")
    .select("assigned_recruiter")
    .not("assigned_recruiter", "is", null);
  const unique = [...new Set((distinct || []).map((r: { assigned_recruiter: string }) => r.assigned_recruiter))];
  console.log(unique);

  console.log("\n=== 3. Profiles table columns (check for avatar_url) ===");
  // Try selecting with avatar_url — will error if column doesn't exist
  const { data: profileTest, error: profileErr } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, calendar_link, role")
    .eq("role", "recruiter")
    .limit(5);

  if (profileErr) {
    console.error("Profile query with avatar_url FAILED:", profileErr.message);
    // Try without avatar_url
    const { data: profileTest2, error: profileErr2 } = await supabase
      .from("profiles")
      .select("id, full_name, calendar_link, role")
      .eq("role", "recruiter")
      .limit(5);
    if (profileErr2) console.error("Profile query without avatar_url also failed:", profileErr2.message);
    else { console.log("Recruiter profiles (no avatar_url):"); console.table(profileTest2); }
  } else {
    console.log("Recruiter profiles:"); console.table(profileTest);
  }

  console.log("\n=== 4. Test name-based lookup for 'Shelly' ===");
  const { data: shellyProfile, error: shellyErr } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("role", "recruiter")
    .ilike("full_name", "Shelly%")
    .limit(1)
    .maybeSingle();
  if (shellyErr) console.error("Shelly lookup error:", shellyErr.message);
  else console.log("Shelly profile:", shellyProfile);

  console.log("\n=== 5. Test name-based lookup for 'Jerome' ===");
  const { data: jeromeProfile, error: jeromeErr } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("role", "recruiter")
    .ilike("full_name", "Jerome%")
    .limit(1)
    .maybeSingle();
  if (jeromeErr) console.error("Jerome lookup error:", jeromeErr.message);
  else console.log("Jerome profile:", jeromeProfile);

  console.log("\n=== 6. recruiter_assignments table ===");
  const { data: assignments, error: assignmentsErr } = await supabase
    .from("recruiter_assignments")
    .select("*")
    .limit(20);
  if (assignmentsErr) console.error("recruiter_assignments error:", assignmentsErr.message);
  else { console.log("recruiter_assignments rows:"); console.table(assignments); }

  console.log("\n=== 7. Candidates post-AI-interview with no recruiter profile resolvable ===");
  const { data: postAI } = await supabase
    .from("candidates")
    .select("id, full_name, role_category, assigned_recruiter, assignment_pending_review")
    .not("ai_interview_completed_at", "is", null)
    .limit(10);
  console.table(postAI);
}

main().catch(console.error);
