/**
 * Apply migration 00161 — add MFA-aware aal2 enforcement to RLS: a
 * public.mfa_satisfied() helper (aal2 required only for users with a
 * verified MFA factor) plus RESTRICTIVE policies — FOR ALL on the 14
 * sensitive own-row tables, write-only on the 19 other user-writable
 * tables — closing the PostgREST-at-aal1 bypass of the middleware's
 * aal2 page gates.
 *
 * Reads the full SQL file and sends it to the exec_sql RPC as a single
 * payload so the implicit transaction is preserved (any step failing
 * rolls back the entire migration).
 *
 * Run: npx tsx --env-file=.env.local scripts/apply-migration-161.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mshnsbblwgcpwuxwuevp.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY not found in environment");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
  const migrationPath = join(
    process.cwd(),
    "supabase/migrations/00161_mfa_aal2_rls_enforcement.sql"
  );
  console.log("════════════════════════════════════════════════════════════");
  console.log("Applying migration 00161");
  console.log(`File: ${migrationPath}`);
  console.log(`DB:   ${SUPABASE_URL}`);
  console.log("════════════════════════════════════════════════════════════");

  const sql = readFileSync(migrationPath, "utf-8");
  console.log(`SQL size: ${sql.length} bytes, ${sql.split("\n").length} lines`);
  console.log("\nSending full SQL to exec_sql RPC (single transaction)...\n");

  const startedAt = Date.now();
  const { data, error } = await admin.rpc("exec_sql", { query: sql });
  const elapsedMs = Date.now() - startedAt;

  if (error) {
    console.log("❌ MIGRATION FAILED — transport error (transaction rolled back)\n");
    console.log(`  code:    ${error.code}`);
    console.log(`  message: ${error.message}`);
    console.log(`\nElapsed: ${elapsedMs}ms`);
    process.exit(1);
  }

  const body = data as { success?: boolean; error?: string; code?: string };
  if (body && body.success === false) {
    console.log("❌ MIGRATION FAILED — SQL error (transaction rolled back)\n");
    console.log(`  code:    ${body.code}`);
    console.log(`  message: ${body.error}`);
    console.log(`\nElapsed: ${elapsedMs}ms`);
    process.exit(1);
  }

  console.log(`✅ Migration 00161 applied in ${elapsedMs}ms`);
  console.log("Next: npx tsx --env-file=.env.local scripts/probe-aal2-enforcement.ts");
}

main();
