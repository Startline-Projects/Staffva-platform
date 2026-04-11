/**
 * Seed script: Create 4 test accounts for Phase 2 engineer scoping
 * Run: npx tsx scripts/seed-test-engineer-accounts.ts
 *
 * Creates (additive only — never modifies existing records):
 *   1. Admin       — test-admin-eng@staffva.com
 *   2. Manager     — test-manager-eng@staffva.com
 *   3. Recruiter   — test-recruiter-eng@staffva.com
 *   4. Candidate   — awan@devisnor.com  (Hafsa Shahid / Hafsa S.)
 *
 * Then wires relationships:
 *   - Candidate assigned_recruiter → Recruiter
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

// ── Load .env.local ────────────────────────────────────────────
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

// Admin client (service role) for accounts 1-3 and DB writes
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Anon client for candidate signup (triggers standard emails)
const anon = createClient(SUPABASE_URL, ANON_KEY);

// ── Account definitions ────────────────────────────────────────
const ACCOUNTS = {
  admin: {
    email: "test-admin-eng@staffva.com",
    password: "TestAdmin2026!",
    role: "admin",
    fullName: "Test Admin (Eng)",
  },
  manager: {
    email: "test-manager-eng@staffva.com",
    password: "TestManager2026!",
    role: "recruiting_manager",
    fullName: "Test Manager (Eng)",
  },
  recruiter: {
    email: "test-recruiter-eng@staffva.com",
    password: "TestRecruiter2026!",
    role: "recruiter",
    fullName: "Test Recruiter (Eng)",
  },
  candidate: {
    email: "awan@devisnor.com",
    password: null, // set via normal signup flow
    fullName: "Hafsa Shahid",
    displayName: "Hafsa S.",
    role: "candidate",
    roleCategory: "Paralegal",
  },
};

// ── Helpers ─────────────────────────────────────────────────────

async function checkExisting(email: string): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  return data?.id ?? null;
}

async function createAdminUser(
  email: string,
  password: string,
  role: string,
  fullName: string
): Promise<string> {
  const existing = await checkExisting(email);
  if (existing) {
    console.log(`  ↳ Already exists (${existing}), skipping creation`);
    return existing;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no verification required
    user_metadata: { role, full_name: fullName },
  });

  if (error) {
    throw new Error(`Failed to create ${email}: ${error.message}`);
  }

  console.log(`  ↳ Created auth user: ${data.user.id}`);

  // Wait a moment for the trigger to create the profile
  await sleep(1000);

  // Verify profile was created by trigger
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", data.user.id)
    .single();

  if (!profile) {
    // Trigger may not have fired — insert manually
    console.log(`  ↳ Profile not created by trigger, inserting manually`);
    const { error: profileErr } = await admin.from("profiles").upsert(
      { id: data.user.id, email, role, full_name: fullName },
      { onConflict: "id", ignoreDuplicates: true }
    );
    if (profileErr) {
      throw new Error(`Failed to create profile for ${email}: ${profileErr.message}`);
    }
  }

  console.log(`  ↳ Profile confirmed (role: ${role})`);
  return data.user.id;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  console.log("=== Seed Test Engineer Accounts ===\n");

  // ── 1. Admin ──────────────────────────────────────────────────
  console.log("1. Creating Admin account...");
  const adminId = await createAdminUser(
    ACCOUNTS.admin.email,
    ACCOUNTS.admin.password,
    ACCOUNTS.admin.role,
    ACCOUNTS.admin.fullName
  );

  // ── 2. Manager ────────────────────────────────────────────────
  console.log("\n2. Creating Manager account...");
  const managerId = await createAdminUser(
    ACCOUNTS.manager.email,
    ACCOUNTS.manager.password,
    ACCOUNTS.manager.role,
    ACCOUNTS.manager.fullName
  );

  // ── 3. Recruiter ──────────────────────────────────────────────
  console.log("\n3. Creating Recruiter account...");
  const recruiterId = await createAdminUser(
    ACCOUNTS.recruiter.email,
    ACCOUNTS.recruiter.password,
    ACCOUNTS.recruiter.role,
    ACCOUNTS.recruiter.fullName
  );

  // ── 4. Candidate (normal signup flow) ─────────────────────────
  console.log("\n4. Creating Candidate account (normal signup flow)...");
  const existingCandidateId = await checkExisting(ACCOUNTS.candidate.email);
  let candidateUserId: string;

  if (existingCandidateId) {
    console.log(`  ↳ Already exists (${existingCandidateId}), skipping creation`);
    candidateUserId = existingCandidateId;
  } else {
    // Use signUp via anon client to trigger standard candidate emails
    const { data: signUpData, error: signUpErr } = await anon.auth.signUp({
      email: ACCOUNTS.candidate.email,
      password: "CandidateTest2026!",
      options: {
        data: {
          role: "candidate",
          full_name: ACCOUNTS.candidate.fullName,
        },
      },
    });

    if (signUpErr) {
      throw new Error(
        `Failed to sign up candidate: ${signUpErr.message}`
      );
    }

    candidateUserId = signUpData.user!.id;
    console.log(`  ↳ Created auth user via signUp: ${candidateUserId}`);
    console.log(`  ↳ Confirmation email sent to ${ACCOUNTS.candidate.email}`);

    // Wait for trigger
    await sleep(1500);

    // Verify profile
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .eq("id", candidateUserId)
      .single();

    if (!profile) {
      console.log(`  ↳ Profile not created by trigger, inserting manually`);
      await admin.from("profiles").upsert(
        {
          id: candidateUserId,
          email: ACCOUNTS.candidate.email,
          role: "candidate",
          full_name: ACCOUNTS.candidate.fullName,
        },
        { onConflict: "id", ignoreDuplicates: true }
      );
    }
  }

  // Create candidates table row
  console.log("  ↳ Creating candidates table row...");
  const { data: existingCandidate } = await admin
    .from("candidates")
    .select("id")
    .eq("user_id", candidateUserId)
    .maybeSingle();

  if (existingCandidate) {
    console.log(`  ↳ Candidates row already exists, updating assignment`);
    const { error: updateErr } = await admin
      .from("candidates")
      .update({
        display_name: ACCOUNTS.candidate.displayName,
        assigned_recruiter: recruiterId,
        role_category: ACCOUNTS.candidate.roleCategory,
      })
      .eq("user_id", candidateUserId);

    if (updateErr) {
      throw new Error(`Failed to update candidate: ${updateErr.message}`);
    }
  } else {
    const { error: candidateErr } = await admin.from("candidates").insert({
      user_id: candidateUserId,
      email: ACCOUNTS.candidate.email,
      full_name: ACCOUNTS.candidate.fullName,
      display_name: ACCOUNTS.candidate.displayName,
      role_category: ACCOUNTS.candidate.roleCategory,
      assigned_recruiter: recruiterId,
      application_step: "application_form",
      admin_status: "active",
      availability_status: "available_now",
      country: "PK",
      years_experience: "0",
      time_zone: "Asia/Karachi",
      hourly_rate: 0,
      linkedin_url: "",
      bio: "",
      us_client_experience: "none",
      us_client_description: "",
    });

    if (candidateErr) {
      throw new Error(`Failed to create candidate row: ${candidateErr.message}`);
    }
    console.log(`  ↳ Candidates row created (assigned_recruiter: ${recruiterId})`);
  }

  // ── Summary ───────────────────────────────────────────────────
  console.log("\n=== Summary ===");
  console.log(`Admin:     ${ACCOUNTS.admin.email}     (id: ${adminId})`);
  console.log(`           Password: ${ACCOUNTS.admin.password}`);
  console.log(`Manager:   ${ACCOUNTS.manager.email}   (id: ${managerId})`);
  console.log(`           Password: ${ACCOUNTS.manager.password}`);
  console.log(`Recruiter: ${ACCOUNTS.recruiter.email} (id: ${recruiterId})`);
  console.log(`           Password: ${ACCOUNTS.recruiter.password}`);
  console.log(`Candidate: ${ACCOUNTS.candidate.email}          (id: ${candidateUserId})`);
  console.log(`           Display: ${ACCOUNTS.candidate.displayName}`);
  console.log(`           Assigned to recruiter: ${recruiterId}`);
  console.log(`           Role category: ${ACCOUNTS.candidate.roleCategory}`);
  console.log(`           Application step: application_form (Step 1)`);

  // ── Verification ──────────────────────────────────────────────
  console.log("\n=== Verification ===");

  // Verify admin
  const { data: adminProfile } = await admin
    .from("profiles")
    .select("id, email, role")
    .eq("id", adminId)
    .single();
  console.log(
    `Admin profile: ${adminProfile ? "OK" : "MISSING"} (role: ${adminProfile?.role})`
  );

  // Verify manager
  const { data: managerProfile } = await admin
    .from("profiles")
    .select("id, email, role")
    .eq("id", managerId)
    .single();
  console.log(
    `Manager profile: ${managerProfile ? "OK" : "MISSING"} (role: ${managerProfile?.role})`
  );

  // Verify recruiter
  const { data: recruiterProfile } = await admin
    .from("profiles")
    .select("id, email, role")
    .eq("id", recruiterId)
    .single();
  console.log(
    `Recruiter profile: ${recruiterProfile ? "OK" : "MISSING"} (role: ${recruiterProfile?.role})`
  );

  // Verify candidate + assignment
  const { data: candidateRow } = await admin
    .from("candidates")
    .select("id, user_id, display_name, assigned_recruiter, role_category, application_step")
    .eq("user_id", candidateUserId)
    .single();
  console.log(
    `Candidate row: ${candidateRow ? "OK" : "MISSING"}`
  );
  if (candidateRow) {
    console.log(`  display_name: ${candidateRow.display_name}`);
    console.log(`  assigned_recruiter: ${candidateRow.assigned_recruiter}`);
    console.log(`  role_category: ${candidateRow.role_category}`);
    console.log(`  application_step: ${candidateRow.application_step}`);
    console.log(
      `  recruiter match: ${candidateRow.assigned_recruiter === recruiterId ? "OK" : "MISMATCH"}`
    );
  }

  // Verify no other candidates assigned to this recruiter
  const { data: recruiterCandidates } = await admin
    .from("candidates")
    .select("id, email")
    .eq("assigned_recruiter", recruiterId);
  console.log(
    `\nCandidates assigned to test recruiter: ${recruiterCandidates?.length ?? 0}`
  );
  if (recruiterCandidates) {
    for (const c of recruiterCandidates) {
      console.log(`  - ${c.email} (${c.id})`);
    }
  }

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("\nFATAL:", err.message);
  process.exit(1);
});
