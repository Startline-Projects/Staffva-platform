/**
 * Drift guard for both notification matrices.
 *
 * Scans every `recipientKind: "candidate"` and `recipientKind: "client"` send
 * in the codebase and fails if a type is missing from its matrix — so a new
 * email cannot be added without someone deciding how the person learns of it
 * in the product (candidates while the freeze holds; clients at all). Also
 * reports the reverse: matrix rows for types that no longer exist.
 *
 *   npx tsx scripts/verify-notifications.mts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CANDIDATE_NOTIFICATIONS, silentEvents, knownTypes } from "../src/lib/notificationMatrix.ts";
import {
  clientSilentEvents,
  clientKnownTypes,
  CLIENT_COVERAGE_GAPS,
} from "../src/lib/clientNotificationMatrix.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts)$/.test(p)) out.push(p);
  }
  return out;
}

const files = walk("src");

function scan(kind: "candidate" | "client"): Map<string, string[]> {
  const out = new Map<string, string[]>();
  // The literal form, which is how most call sites are written, plus the
  // shape enqueueEmail uses (options spread across lines).
  const patterns = [
    new RegExp(`recipientKind:\\s*"${kind}"\\s*,\\s*emailType:\\s*"([a-z_]+)"`, "g"),
    new RegExp(`recipientKind:\\s*"${kind}"\\s*,\\s*\\n\\s*emailType:\\s*"([a-z_]+)"`, "g"),
  ];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const list = out.get(m[1]) ?? [];
        list.push(f);
        out.set(m[1], list);
      }
    }
  }
  return out;
}

const found = scan("candidate");

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

// ── The client side ─────────────────────────────────────────────────────────
// Client email is not frozen, so the question is not "does it send" but "does
// it also reach them in the product".
const clientFound = scan("client");
const clientKnown = clientKnownTypes();
const clientMissing = [...clientFound.keys()].filter((t) => !clientKnown.has(t)).sort();
const clientStale = [...clientKnown].filter((t) => !clientFound.has(t)).sort();

console.log(
  `\n${clientFound.size} client email types in code, ${clientKnown.size} in the client matrix`
);
const clientSilent = clientSilentEvents();
console.log(`Client events with no bell (${clientSilent.length}) — each with a reason on record:`);
for (const r of clientSilent) console.log(`  ${r.type.padEnd(28)} ${r.event}`);

console.log(
  `\nClient events reaching them through NOTHING (${CLIENT_COVERAGE_GAPS.length}) — no email, no bell:`
);
for (const g of CLIENT_COVERAGE_GAPS) console.log(`  ${g.event}\n    → ${g.where}`);

if (clientMissing.length) {
  bad = true;
  console.error(`\nFAIL — sent to clients in code, absent from the client matrix:`);
  for (const t of clientMissing) console.error(`  ${t}  (${clientFound.get(t)!.join(", ")})`);
}
if (clientStale.length) {
  console.log(`\nIn the client matrix, not found by the scan: ${clientStale.join(", ")}`);
}

if (bad) process.exit(1);
console.log("\nOK — every candidate and client email type is accounted for.");
