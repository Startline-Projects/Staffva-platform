/**
 * Migration: email verification columns
 * Run: node scripts/migrate-email-verification.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SUPABASE_URL = "https://mshnsbblwgcpwuxwuevp.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaG5zYmJsd2djcHd1eHd1ZXZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDEzMjYwOSwiZXhwIjoyMDg5NzA4NjA5fQ.VoSXw8GzKY0VqOkEjA_YJ-fYoaRMwi9yoO9shOxa3qY";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function run() {
  console.log("\n🔧 Running email verification migration...\n");
  const sql = readFileSync("supabase/migrations/00027_email_verification.sql", "utf-8");
  const { error } = await supabase.rpc("exec_sql", { query: sql });
  if (error) { console.log("❌ Failed:", error.message); return; }
  console.log("✅ Migration complete");
  await supabase.rpc("exec_sql", { query: "NOTIFY pgrst, 'reload schema';" });
  console.log("✅ Schema cache reloaded");

  // Mark all existing users as verified (they signed up before this feature)
  const { error: updateErr } = await supabase.from("profiles").update({ email_verified: true }).not("id", "is", null);
  console.log(updateErr ? "❌ Failed to mark existing users:" + updateErr.message : "✅ Existing users marked as verified");
}

run().catch(console.error);
