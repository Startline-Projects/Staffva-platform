/**
 * Owner directive, 2026-09-07: list the ENTIRE candidate pipeline, regardless
 * of interview or English outcome.
 *
 * What the data actually showed when this ran (worth keeping, because the
 * directive's premise was different from reality): of the 223 candidates this
 * promotes, ZERO had ever attempted the English test and ZERO had an
 * interview attempt row. They are not people who failed — they are people who
 * signed up and stopped. 202 of them have no profile photo, 21 have a resume.
 *
 * That is why this ships alongside the `is_assessed` marker: the browse pool
 * now contains two genuinely different populations, and every client-facing
 * surface says which is which rather than implying the whole pool was vetted.
 *
 * Deliberately NOT using promote_candidate_if_ready(): that function exists to
 * enforce the interview/English gates, and this is an explicit owner override
 * of exactly those gates. A direct UPDATE is the honest tool — with every
 * prior status written to the append-only candidate_status_events log, which
 * is the only record that would otherwise be destroyed by a bulk write.
 *
 * Run:  node --env-file=.env.local scripts/relist-full-pipeline.mjs [--dry]
 */
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const DRY = process.argv.includes("--dry");

// The owner's own test accounts. A talent pool that shows clients "Test1 T."
// is its own kind of dishonesty; excluded here and reported, not silently.
const TEST_ACCOUNTS = /^yousefalaaeldin050(\+candidate)?@gmail\.com$/i;

const REASON =
  "Owner directive 2026-09-07: relist the full pipeline regardless of " +
  "interview/English outcome. Promoted candidates carry is_assessed=false " +
  "until they complete screening.";

const { data: all, error } = await db
  .from("candidates")
  .select("id, email, display_name, admin_status, permanently_blocked");
if (error) {
  console.error("candidate read failed:", error.message);
  process.exit(1);
}

const targets = all.filter(
  (r) =>
    r.admin_status !== "approved" &&
    !r.permanently_blocked &&
    !TEST_ACCOUNTS.test(r.email || "")
);
const skipped = all.filter(
  (r) => r.admin_status !== "approved" && TEST_ACCOUNTS.test(r.email || "")
);

console.log(`to promote: ${targets.length}`);
console.log(`skipped (test accounts): ${skipped.length}`);
skipped.forEach((r) => console.log(`   - ${r.email}`));
if (DRY) {
  console.log("\n[--dry: nothing written]");
  process.exit(0);
}

let promoted = 0;
let failed = 0;
const CHUNK = 25;

for (let i = 0; i < targets.length; i += CHUNK) {
  const batch = targets.slice(i, i + CHUNK);

  // CAS on "not already approved" so a concurrent promotion can't be
  // double-counted or double-logged.
  const { data: updated, error: uerr } = await db
    .from("candidates")
    .update({ admin_status: "approved" })
    .in("id", batch.map((r) => r.id))
    .neq("admin_status", "approved")
    .select("id");

  if (uerr) {
    console.error(`\nbatch @${i} FAILED: ${uerr.message}`);
    failed += batch.length;
    continue;
  }

  const done = new Set((updated ?? []).map((r) => r.id));
  promoted += done.size;

  const events = batch
    .filter((r) => done.has(r.id))
    .map((r) => ({
      candidate_id: r.id,
      from_status: r.admin_status,
      to_status: "approved",
      actor_role: "admin",
      reason: REASON,
    }));

  if (events.length) {
    const { error: eerr } = await db
      .from("candidate_status_events")
      .insert(events);
    // Loud, not fatal: the promotion is done and correct; a missing history
    // row is a gap in the record, and silence about it is how gaps become
    // permanent.
    if (eerr) console.error(`\nevent log @${i} FAILED: ${eerr.message}`);
  }

  process.stdout.write(`\r  promoted ${promoted}/${targets.length}`);
}

console.log(`\ndone. promoted=${promoted} failed=${failed}`);
