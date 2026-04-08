/**
 * Run migration 00062 — internal messaging tables
 * npx tsx scripts/run-migration-062.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const admin = createClient(
  "https://mshnsbblwgcpwuxwuevp.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const sql = readFileSync("./supabase/migrations/00062_internal_messaging.sql", "utf-8");

  // Split by statement and run each individually
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const stmt of statements) {
    const { error } = await admin.rpc("exec_sql", { query: stmt + ";" }).single();
    if (error) {
      // Try direct query via REST if rpc not available
      console.log("Statement:", stmt.slice(0, 60) + "...");
      console.log("Error:", error.message);
    } else {
      console.log("OK:", stmt.slice(0, 60));
    }
  }
}

main().catch(console.error);
