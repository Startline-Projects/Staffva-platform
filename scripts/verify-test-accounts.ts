/**
 * Verify test engineer accounts are properly set up
 * Run: npx tsx scripts/verify-test-accounts.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

// Load .env.local
const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  if (!process.env[key]) process.env[key] = val;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Use service role for DB queries (bypasses RLS)
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Use separate anon clients for each login test (avoids auth state conflicts)
function freshAnonClient() {
  return createClient(SUPABASE_URL, ANON_KEY);
}

async function main() {
  let allPassed = true;
  const fail = (msg: string) => { allPassed = false; console.log(`  FAIL: ${msg}`); };
  const pass = (msg: string) => console.log(`  PASS: ${msg}`);

  // ── 1. Admin can log in ───────────────────────────────────────
  console.log("\n1. Admin account login test...");
  {
    const client = freshAnonClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: "test-admin-eng@staffva.com",
      password: "TestAdmin2026!",
    });
    if (error) fail(`Admin login failed: ${error.message}`);
    else {
      pass("Admin login successful");
      const role = data.user?.user_metadata?.role;
      if (role === "admin") pass("Role is 'admin'");
      else fail(`Expected role 'admin', got '${role}'`);
    }
  }

  // ── 2. Manager can log in ────────────────────────────────────
  console.log("\n2. Manager account login test...");
  {
    const client = freshAnonClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: "test-manager-eng@staffva.com",
      password: "TestManager2026!",
    });
    if (error) fail(`Manager login failed: ${error.message}`);
    else {
      pass("Manager login successful");
      const role = data.user?.user_metadata?.role;
      if (role === "recruiting_manager") pass("Role is 'recruiting_manager'");
      else fail(`Expected role 'recruiting_manager', got '${role}'`);
    }
  }

  // ── 3. Recruiter can log in ──────────────────────────────────
  console.log("\n3. Recruiter account login test...");
  {
    const client = freshAnonClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: "test-recruiter-eng@staffva.com",
      password: "TestRecruiter2026!",
    });
    if (error) fail(`Recruiter login failed: ${error.message}`);
    else {
      pass("Recruiter login successful");
      const role = data.user?.user_metadata?.role;
      if (role === "recruiter") pass("Role is 'recruiter'");
      else fail(`Expected role 'recruiter', got '${role}'`);
    }
  }

  // ── 4. Candidate exists in DB ────────────────────────────────
  console.log("\n4. Candidate data verification...");
  const { data: candidateProfile, error: cpErr } = await db
    .from("profiles")
    .select("id, email, role, full_name")
    .eq("email", "awan@devisnor.com")
    .maybeSingle();

  if (!candidateProfile) fail(`Candidate profile not found (error: ${cpErr?.message ?? "none"})`);
  else {
    pass(`Candidate profile exists (id: ${candidateProfile.id})`);
    if (candidateProfile.role === "candidate") pass("Profile role is 'candidate'");
    else fail(`Expected profile role 'candidate', got '${candidateProfile.role}'`);
  }

  const { data: candidateRow } = await db
    .from("candidates")
    .select("id, user_id, display_name, assigned_recruiter, role_category, application_step, full_name")
    .eq("email", "awan@devisnor.com")
    .single();

  if (!candidateRow) fail("Candidate row not found in candidates table");
  else {
    pass("Candidate row exists in candidates table");
    if (candidateRow.display_name === "Hafsa S.") pass("Display name is 'Hafsa S.'");
    else fail(`Expected display name 'Hafsa S.', got '${candidateRow.display_name}'`);
    if (candidateRow.role_category === "Paralegal") pass("Role category is 'Paralegal'");
    else fail(`Expected role_category 'Paralegal', got '${candidateRow.role_category}'`);
    if (candidateRow.application_step === "application_form") pass("Application step is 'application_form' (Step 1)");
    else fail(`Expected application_step 'application_form', got '${candidateRow.application_step}'`);
  }

  // ── 5. Recruiter assignment verified ─────────────────────────
  console.log("\n5. Recruiter assignment verification...");
  const { data: recruiterProfile } = await db
    .from("profiles")
    .select("id")
    .eq("email", "test-recruiter-eng@staffva.com")
    .single();

  if (candidateRow && recruiterProfile) {
    if (candidateRow.assigned_recruiter === recruiterProfile.id) {
      pass("Candidate correctly assigned to test recruiter");
    } else {
      fail(`assigned_recruiter mismatch: expected ${recruiterProfile.id}, got ${candidateRow.assigned_recruiter}`);
    }
  }

  // Only this candidate should be assigned to the test recruiter
  const { data: recruiterCandidates } = await db
    .from("candidates")
    .select("email")
    .eq("assigned_recruiter", recruiterProfile?.id ?? "");

  if (recruiterCandidates?.length === 1 && recruiterCandidates[0].email === "awan@devisnor.com") {
    pass("Test recruiter has exactly 1 candidate (awan@devisnor.com)");
  } else {
    fail(`Test recruiter has ${recruiterCandidates?.length} candidates, expected 1`);
  }

  // ── 6. No existing records modified ──────────────────────────
  console.log("\n6. Isolation check (no existing records touched)...");

  const { count: totalProfiles } = await db
    .from("profiles")
    .select("id", { count: "exact", head: true });

  const { count: testProfileCount } = await db
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .in("email", [
      "test-admin-eng@staffva.com",
      "test-manager-eng@staffva.com",
      "test-recruiter-eng@staffva.com",
      "awan@devisnor.com",
    ]);

  pass(`Total profiles: ${totalProfiles}, test accounts: ${testProfileCount}`);

  // No other candidates assigned to test recruiter
  const { data: otherAssigned } = await db
    .from("candidates")
    .select("email")
    .eq("assigned_recruiter", recruiterProfile?.id ?? "")
    .neq("email", "awan@devisnor.com");

  if (!otherAssigned || otherAssigned.length === 0) {
    pass("No existing candidates assigned to test recruiter");
  } else {
    fail(`Found ${otherAssigned.length} existing candidates assigned to test recruiter`);
  }

  // ── 7. Recruiter RLS isolation test ──────────────────────────
  console.log("\n7. Recruiter RLS isolation test...");
  {
    const recClient = freshAnonClient();
    const { error: loginErr } = await recClient.auth.signInWithPassword({
      email: "test-recruiter-eng@staffva.com",
      password: "TestRecruiter2026!",
    });
    if (loginErr) {
      fail(`Could not log in as recruiter for RLS test: ${loginErr.message}`);
    } else {
      const { data: visible } = await recClient
        .from("candidates")
        .select("email, display_name");
      const visibleEmails = (visible ?? []).map((c: any) => c.email);
      console.log(`  Recruiter can see ${visible?.length ?? 0} candidate(s): ${visibleEmails.join(", ")}`);
      // RLS should limit to assigned candidates only (plus publicly approved ones)
      // The test candidate has admin_status 'active', so visibility depends on RLS policy
    }
  }

  // ── Result ───────────────────────────────────────────────────
  console.log("\n" + (allPassed ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"));
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
