/**
 * Migration: badge renames
 * Run: node scripts/migrate-badge-renames.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SUPABASE_URL = "https://mshnsbblwgcpwuxwuevp.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaG5zYmJsd2djcHd1eHd1ZXZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDEzMjYwOSwiZXhwIjoyMDg5NzA4NjA5fQ.VoSXw8GzKY0VqOkEjA_YJ-fYoaRMwi9yoO9shOxa3qY";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function run() {
  console.log("\n🔧 Running badge renames migration...\n");

  // Run each statement separately — ALTER TYPE ADD VALUE can't be in a transaction
  const statements = [
    "ALTER TYPE english_written_tier_type ADD VALUE IF NOT EXISTS 'advanced';",
    "ALTER TYPE english_written_tier_type ADD VALUE IF NOT EXISTS 'professional';",
    "ALTER TYPE speaking_level_type ADD VALUE IF NOT EXISTS 'developing';",
  ];

  for (const sql of statements) {
    const { error } = await supabase.rpc("exec_sql", { query: sql });
    if (error && !error.message.includes("already exists")) {
      console.log("❌ Enum error:", error.message);
    }
  }
  console.log("✅ Enum values added");

  // Migrate data
  const migrations = [
    { from: "proficient", to: "advanced", field: "english_written_tier" },
    { from: "competent", to: "professional", field: "english_written_tier" },
    { from: "basic", to: "developing", field: "speaking_level" },
  ];

  for (const m of migrations) {
    const { error } = await supabase.rpc("exec_sql", {
      query: `UPDATE candidates SET ${m.field} = '${m.to}' WHERE ${m.field} = '${m.from}';`,
    });
    if (error) console.log(`❌ Migration ${m.from}→${m.to}: ${error.message}`);
    else console.log(`✅ ${m.field}: ${m.from} → ${m.to}`);
  }

  // Verify no old values remain
  const { data: oldProficient } = await supabase.from("candidates").select("id").eq("english_written_tier", "proficient");
  const { data: oldCompetent } = await supabase.from("candidates").select("id").eq("english_written_tier", "competent");
  const { data: oldBasic } = await supabase.from("candidates").select("id").eq("speaking_level", "basic");

  console.log(`\n✅ Verification:`);
  console.log(`   proficient (tier) remaining: ${oldProficient?.length || 0}`);
  console.log(`   competent remaining: ${oldCompetent?.length || 0}`);
  console.log(`   basic remaining: ${oldBasic?.length || 0}`);

  await supabase.rpc("exec_sql", { query: "NOTIFY pgrst, 'reload schema';" });
  console.log("✅ Schema cache reloaded");
}

run().catch(console.error);
