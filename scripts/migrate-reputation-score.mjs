/**
 * Migration: reputation_score columns
 * Run: node scripts/migrate-reputation-score.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SUPABASE_URL = "https://mshnsbblwgcpwuxwuevp.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaG5zYmJsd2djcHd1eHd1ZXZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDEzMjYwOSwiZXhwIjoyMDg5NzA4NjA5fQ.VoSXw8GzKY0VqOkEjA_YJ-fYoaRMwi9yoO9shOxa3qY";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function runMigration() {
  console.log("\n🔧 Running reputation_score migration...\n");

  const sql = readFileSync("supabase/migrations/00025_reputation_score.sql", "utf-8");
  const { error } = await supabase.rpc("exec_sql", { query: sql });

  if (error) {
    console.log(`❌ Migration failed: ${error.message}`);
    return;
  }

  console.log("✅ Migration complete — reputation_score, reputation_tier, reputation_percentile columns added");
  await supabase.rpc("exec_sql", { query: "NOTIFY pgrst, 'reload schema';" });
  console.log("✅ Schema cache reloaded");
}

runMigration().catch(console.error);
