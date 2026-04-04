/**
 * Migration: profile_views table
 * Run: node scripts/migrate-profile-views.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SUPABASE_URL = "https://mshnsbblwgcpwuxwuevp.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaG5zYmJsd2djcHd1eHd1ZXZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDEzMjYwOSwiZXhwIjoyMDg5NzA4NjA5fQ.VoSXw8GzKY0VqOkEjA_YJ-fYoaRMwi9yoO9shOxa3qY";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function runMigration() {
  console.log("\n🔧 Running profile_views migration...\n");

  // Drop existing table if it exists without unique constraint
  await supabase.rpc("exec_sql", { query: "DROP TABLE IF EXISTS profile_views CASCADE;" });

  const sql = readFileSync("supabase/migrations/00024_profile_views.sql", "utf-8");
  const { error } = await supabase.rpc("exec_sql", { query: sql });

  if (error) {
    console.log(`❌ Migration failed: ${error.message}`);
    return;
  }

  console.log("✅ Migration complete — profile_views table created with unique constraint");

  await supabase.rpc("exec_sql", { query: "NOTIFY pgrst, 'reload schema';" });
  console.log("✅ Schema cache reloaded");
}

runMigration().catch(console.error);
