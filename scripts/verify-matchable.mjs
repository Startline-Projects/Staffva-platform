/**
 * The TS and SQL definitions of "matchable" must agree, row for row.
 *
 * computeVisibility() drives what the candidate is told; candidate_is_matchable()
 * drives what the marketplace and the role list actually do. If they drift, a
 * candidate reads "you're not being matched" directly above a list of roles they
 * are supposedly in the running for — which is the committed_hours failure of
 * step 13, repeated.
 *
 * Usage: npx tsx scripts/verify-matchable.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { computeVisibility } from "../src/lib/candidateVisibility.ts";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data: all, error } = await db
  .from("candidates")
  .select(
    "id, admin_status, permanently_blocked, id_verification_status, id_verification_due_at, availability_status, availability_last_updated_at, created_at, lock_status"
  );
if (error) throw new Error(error.message);

const { data: sqlRows, error: vErr } = await db.from("matchable_candidates").select("id");
if (vErr) throw new Error(vErr.message);

const sqlSet = new Set(sqlRows.map((r) => r.id));
const tsSet = new Set(all.filter((c) => computeVisibility(c).matchable).map((c) => c.id));

const onlyTs = [...tsSet].filter((id) => !sqlSet.has(id));
const onlySql = [...sqlSet].filter((id) => !tsSet.has(id));

console.log(`candidates:        ${all.length}`);
console.log(`matchable (TS):    ${tsSet.size}`);
console.log(`matchable (SQL):   ${sqlSet.size}`);
console.log(`only TS thinks so: ${onlyTs.length}`);
console.log(`only SQL thinks so:${onlySql.length}`);

if (onlyTs.length || onlySql.length) {
  for (const id of [...onlyTs, ...onlySql].slice(0, 10)) {
    const c = all.find((x) => x.id === id);
    console.error(`  DIVERGES ${id} status=${c.admin_status} avail=${c.availability_status} lock=${c.lock_status} idv=${c.id_verification_status}`);
  }
  process.exit(1);
}
console.log("\nPASS — the two predicates agree on every row.");
