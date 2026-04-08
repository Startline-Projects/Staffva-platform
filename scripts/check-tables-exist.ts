/**
 * Check if internal_* tables exist via exec_sql
 * npx tsx scripts/check-tables-exist.ts
 */
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  "https://mshnsbblwgcpwuxwuevp.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data, error } = await admin.rpc("exec_sql", {
    query: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'internal%' ORDER BY table_name;",
  });
  console.log("Tables check:", error ? "ERROR: " + error.message : JSON.stringify(data));

  // Also try inserting to see if it works
  const { data: d2, error: e2 } = await admin.rpc("exec_sql", {
    query: "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';",
  });
  console.log("Total tables:", e2 ? "ERROR: " + e2.message : JSON.stringify(d2));
}

main().catch(console.error);
