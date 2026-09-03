/**
 * Apply migration 00160 — give the nine "Admin can manage ..." policies a
 * real admin qual (public.is_admin(): profiles.role admin/recruiting_manager,
 * SECURITY DEFINER) instead of USING (true), closing the anon/authenticated
 * UPDATE-any-row hole 00159 left tracked as a policy bug.
 *
 * Reads the full SQL file and sends it to the exec_sql RPC as a single
 * payload so the implicit transaction is preserved (any step failing
 * rolls back the entire migration).
 *
 * Run: npx tsx --env-file=.env.local scripts/apply-migration-160.ts
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
    "supabase/migrations/00160_admin_policies_real_admin_check.sql"
  );
  console.log("════════════════════════════════════════════════════════════");
  console.log("Applying migration 00160");
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

  console.log(`✅ Migration 00160 applied in ${elapsedMs}ms`);
  console.log("Next: npx tsx --env-file=.env.local scripts/probe-admin-policy-hole.ts");
}

main();
