/**
 * Every contract, and the verdict the shared predicate gives it.
 * Usage: npx tsx scripts/verify-contracts.mts
 */
import { createClient } from "@supabase/supabase-js";
import { loadCandidateContracts, signableContracts, flaggedContracts } from "../src/lib/candidateContracts";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data: rows } = await db.from("engagement_contracts").select("candidate_id");
const ids = [...new Set((rows ?? []).map((r) => r.candidate_id))];
const { data: cands } = await db.from("candidates").select("id, display_name").in("id", ids);

let sign = 0, flag = 0, total = 0;
for (const c of cands ?? []) {
  const list = await loadCandidateContracts(c.id);
  for (const k of list) {
    total++;
    console.log(
      `${(c.display_name ?? "?").padEnd(11)} ${k.status.padEnd(18)} eng=${(k.engagementStatus ?? "-").padEnd(9)} -> ${k.blockReason ?? "SIGNABLE"}`
    );
  }
  sign += signableContracts(list).length;
  flag += flaggedContracts(list).length;
}
console.log(`\ntotal=${total} signable=${sign} flagged=${flag}`);
