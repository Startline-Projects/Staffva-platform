/**
 * Drift guard for src/lib/notificationMatrix.ts.
 *
 * Scans every `recipientKind: "candidate"` send in the codebase and fails if a
 * type is missing from the matrix — so a new candidate email cannot be added
 * without someone deciding how the candidate learns of it while the freeze
 * holds. Also reports the reverse: matrix rows for types that no longer exist.
 *
 *   npx tsx scripts/verify-notifications.mts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CANDIDATE_NOTIFICATIONS, silentEvents, knownTypes } from "../src/lib/notificationMatrix.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts)$/.test(p)) out.push(p);
  }
  return out;
}

const files = walk("src");
const found = new Map<string, string[]>();

// The literal form, which is how all but three call sites are written.
const LITERAL = /recipientKind:\s*"candidate"\s*,\s*emailType:\s*"([a-z_]+)"/g;
// enqueueEmail spreads the options across lines.
const SPREAD = /recipientKind:\s*"candidate"\s*,\s*\n\s*emailType:\s*"([a-z_]+)"/g;

for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const re of [LITERAL, SPREAD]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const list = found.get(m[1]) ?? [];
      list.push(f);
      found.set(m[1], list);
    }
  }
}

// Three call sites pass emailType as a variable, so the scan cannot see the
// values. They are listed here with the file that produces them, and the
// assertion is that the matrix covers what those files can emit.
const DYNAMIC: Record<string, string[]> = {
  "src/app/api/admin/candidates/review/route.ts": [
    "profile_approved",
    "application_outcome",
    "revision_requested",
  ],
  "src/app/api/candidate-emails/route.ts": ["staff_composed"],
};
for (const [file, types] of Object.entries(DYNAMIC)) {
  for (const t of types) {
    const list = found.get(t) ?? [];
    list.push(`${file} (dynamic)`);
    found.set(t, list);
  }
}

const known = knownTypes();
const missing = [...found.keys()].filter((t) => !known.has(t)).sort();
const stale = [...known].filter((t) => !found.has(t)).sort();

console.log(`scanned ${files.length} files`);
console.log(`${found.size} candidate email types in code, ${known.size} in the matrix\n`);

const silent = silentEvents();
console.log(`Events that reach the candidate through NOTHING (${silent.length}):`);
for (const r of silent) console.log(`  ${r.type.padEnd(26)} ${r.event}`);

const weak = CANDIDATE_NOTIFICATIONS.filter((r) => r.note?.startsWith("WEAK"));
console.log(`\nCovered but weakly (${weak.length}) — the in-app surface only works if they visit:`);
for (const r of weak) console.log(`  ${r.type.padEnd(26)} ${r.event}`);

let bad = false;
if (missing.length) {
  bad = true;
  console.error(`\nFAIL — sent in code, absent from the matrix:`);
  for (const t of missing) console.error(`  ${t}  (${found.get(t)!.join(", ")})`);
}
if (stale.length) {
  // Not a failure. email_verification and password_reset are sent through
  // enqueueEmail in a shape the scan does not match, and a row outliving its
  // sender is harmless.
  console.log(`\nIn the matrix, not found by the scan: ${stale.join(", ")}`);
}

if (bad) process.exit(1);
console.log("\nOK — every candidate email type is accounted for.");
