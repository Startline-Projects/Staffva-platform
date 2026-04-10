/**
 * Run: SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/migrate-remove-speaking-review.mjs
 *
 * Removes 'pending_speaking_review' from admin_status_type enum.
 * Replaces with 'pending_2nd_interview' or 'pending_review' based on second interview state.
 *
 * Split into 3 phases because PostgreSQL requires new enum values
 * to be committed before they can be used in DML/DDL.
 */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mshnsbblwgcpwuxwuevp.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function execSql(label, sql) {
  console.log(`  Running: ${label}...`);
  const { error } = await supabase.rpc("exec_sql", { query: sql });
  if (error) {
    console.error(`  ✗ ${label} failed:`, error.message);
    process.exit(1);
  }
  console.log(`  ✓ ${label}`);
}

async function run() {
  // Pre-check: count candidates still on the old status
  const { data: before, error: countErr } = await supabase
    .from("candidates")
    .select("id, second_interview_status", { count: "exact" })
    .eq("admin_status", "pending_speaking_review");

  if (countErr) {
    console.error("Pre-check failed:", countErr.message);
    process.exit(1);
  }

  console.log(`Found ${before?.length ?? 0} candidates with pending_speaking_review`);
  if (before?.length) {
    const completed = before.filter(c => c.second_interview_status === "completed").length;
    const other = before.length - completed;
    console.log(`  → ${completed} will become pending_review`);
    console.log(`  → ${other} will become pending_2nd_interview`);
  }

  // Phase 1: Add new enum values (must commit before use)
  console.log("\n== Phase 1: Add new enum values ==");
  await execSql("add pending_2nd_interview",
    "ALTER TYPE admin_status_type ADD VALUE IF NOT EXISTS 'pending_2nd_interview';");
  await execSql("add pending_review",
    "ALTER TYPE admin_status_type ADD VALUE IF NOT EXISTS 'pending_review';");

  // Phase 2: Migrate data (new enum values are now committed)
  console.log("\n== Phase 2: Migrate candidate records ==");
  await execSql("migrate completed → pending_review", `
    UPDATE candidates
    SET admin_status = 'pending_review', updated_at = now()
    WHERE admin_status = 'pending_speaking_review'
      AND second_interview_status = 'completed';
  `);
  await execSql("migrate remaining → pending_2nd_interview", `
    UPDATE candidates
    SET admin_status = 'pending_2nd_interview', updated_at = now()
    WHERE admin_status = 'pending_speaking_review';
  `);

  // Phase 3: Rebuild enum without old value
  console.log("\n== Phase 3: Rebuild enum without pending_speaking_review ==");
  await execSql("rebuild enum", `
    ALTER TYPE admin_status_type RENAME TO admin_status_type_old;

    CREATE TYPE admin_status_type AS ENUM (
      'active',
      'pending_2nd_interview',
      'pending_review',
      'profile_review',
      'approved',
      'rejected'
    );

    ALTER TABLE candidates
      ALTER COLUMN admin_status TYPE admin_status_type
      USING admin_status::text::admin_status_type;

    ALTER TABLE candidates
      ALTER COLUMN admin_status SET DEFAULT 'active';

    DROP TYPE admin_status_type_old;
  `);

  // Post-check: confirm zero records remain
  const { data: after, error: afterErr } = await supabase
    .from("candidates")
    .select("id", { count: "exact" })
    .eq("admin_status", "pending_speaking_review");

  if (afterErr) {
    console.log("✓ Post-check: 'pending_speaking_review' no longer exists in enum (query correctly rejected)");
  } else if (after?.length === 0) {
    console.log("✓ Post-check: zero candidates with pending_speaking_review");
  } else {
    console.error("✗ Post-check FAILED: still found candidates with pending_speaking_review");
    process.exit(1);
  }

  console.log("\n✓ Migration complete — pending_speaking_review removed from admin_status_type");
}

run().catch(console.error);
