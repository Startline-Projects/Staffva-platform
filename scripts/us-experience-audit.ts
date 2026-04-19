/**
 * US Client Experience refactor — Phase 1 audit query.
 * Run: npx tsx --env-file=.env.local scripts/us-experience-audit.ts
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mshnsbblwgcpwuxwuevp.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
  console.log("== us_client_experience distribution ==");
  const { data, error } = await admin
    .from("candidates")
    .select("us_client_experience");
  if (error) {
    console.log("ERROR:", error.message);
    process.exit(1);
  }
  const counts: Record<string, number> = {};
  let nullCount = 0;
  for (const row of data || []) {
    const v = (row as { us_client_experience: string | null }).us_client_experience;
    if (v == null) nullCount++;
    else counts[v] = (counts[v] || 0) + 1;
  }
  console.log("total rows:", (data || []).length);
  console.log("null:", nullCount);
  for (const k of Object.keys(counts).sort()) {
    console.log(`${k}: ${counts[k]}`);
  }

  console.log("\n== us_client_description (non-null/non-empty count) ==");
  const { data: descRows, error: descErr } = await admin
    .from("candidates")
    .select("us_client_description");
  if (descErr) {
    console.log("ERROR:", descErr.message);
  } else {
    let nonEmpty = 0;
    let nullDesc = 0;
    for (const r of descRows || []) {
      const v = (r as { us_client_description: string | null }).us_client_description;
      if (v == null) nullDesc++;
      else if (v.trim().length > 0) nonEmpty++;
    }
    console.log("total:", (descRows || []).length, "null:", nullDesc, "non-empty:", nonEmpty);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
