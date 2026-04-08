/**
 * Test that the recruiter profile lookup now works correctly.
 * Simulates exactly what the fixed API does for each candidate.
 * Run with: npx tsx scripts/test-recruiter-profile-fix.ts
 */
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  "https://mshnsbblwgcpwuxwuevp.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function lookupRecruiterProfile(assignedRecruiter: string) {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assignedRecruiter);

  if (isUUID) {
    const { data, error } = await admin
      .from("profiles")
      .select("id, full_name, calendar_link")
      .eq("id", assignedRecruiter)
      .single();
    return { profile: data, error };
  } else {
    const { data, error } = await admin
      .from("profiles")
      .select("id, full_name, calendar_link")
      .eq("role", "recruiter")
      .ilike("full_name", `${assignedRecruiter}%`)
      .limit(1)
      .maybeSingle();
    return { profile: data, error };
  }
}

async function main() {
  // Get candidates who have completed AI interview
  const { data: candidates } = await admin
    .from("candidates")
    .select("id, full_name, role_category, assigned_recruiter, assignment_pending_review")
    .not("ai_interview_completed_at", "is", null)
    .limit(20);

  console.log("\n=== Recruiter profile lookup results for post-AI-interview candidates ===\n");

  let pass = 0, fail = 0;
  for (const c of candidates || []) {
    const isOther = c.role_category === "Other";
    const expectedMessage = isOther && !c.assigned_recruiter
      ? "A recruiter will be assigned to you shortly"
      : "Meet your recruiter";

    let result: string;
    if (!c.assigned_recruiter) {
      result = "No assigned_recruiter → 'A recruiter will be assigned' (correct for Other)";
      if (!isOther) {
        result = "⚠ No assigned_recruiter but role is NOT Other — needs assignment";
        fail++;
      } else {
        pass++;
      }
    } else {
      const { profile, error } = await lookupRecruiterProfile(c.assigned_recruiter);
      if (error) {
        result = `FAIL (query error: ${error.message})`;
        fail++;
      } else if (profile) {
        result = `OK → '${expectedMessage}' — recruiter: ${profile.full_name}`;
        pass++;
      } else {
        result = `FAIL — no profile found for assigned_recruiter=${c.assigned_recruiter}`;
        fail++;
      }
    }

    console.log(`${c.full_name} (${c.role_category}): ${result}`);
  }

  console.log(`\n✓ ${pass} passed, ✗ ${fail} failed`);
}

main().catch(console.error);
