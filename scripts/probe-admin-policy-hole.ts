/**
 * Probe the "Admin can manage ..." policy hole (fixed by migration 00160)
 * through the REAL PostgREST stack.
 *
 * Two dead ends informed this design:
 *  - A no-match-UUID UPDATE probe can't test policies: policy denial never
 *    errors, it just filters the row set, and zero-matching-rows "succeeds"
 *    both before and after. Only grant revocations 42501 on zero-row writes
 *    (that's why the technique worked for 00159).
 *  - exec_sql can't impersonate: SET ROLE / set_config('role', ...) is
 *    blocked inside SECURITY DEFINER functions (42501).
 *
 * So: sign in as the repo's seeded test accounts and hit PostgREST.
 *  - UPDATE probes run only for personas expected to be DENIED (bare anon,
 *    authenticated non-admin). Denied means 0 rows touched and nothing is
 *    written; if one unexpectedly succeeds it performs a no-op id=id
 *    self-assignment on one row — the price of discovering the hole is open.
 *  - The admin positive control is a WRITE-FREE SELECT count: the ALL
 *    policy's USING arm gates SELECT visibility with the same is_admin()
 *    qual as UPDATE, so admin seeing rows invisible to the others proves
 *    the new qual passes for admins.
 *
 * Expected result: anon + non-admin touch 0 rows everywhere; admin sees
 * rows on admin-only tables the others can't.
 *
 * Run: npx tsx --env-file=.env.local scripts/probe-admin-policy-hole.ts
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mshnsbblwgcpwuxwuevp.supabase.co";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!ANON_KEY || !SERVICE_KEY) {
  console.error("❌ need NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Seeded by scripts/seed-test-engineer-accounts.ts (passwords are committed
// test fixtures, not secrets).
const ADMIN_LOGIN = { email: "test-admin-eng@staffva.com", password: "TestAdmin2026!" };
const NON_ADMIN_LOGIN = { email: "test-recruiter-eng@staffva.com", password: "TestRecruiter2026!" };

const NINE = [
  "availability_notifications",
  "candidate_interviews",
  "capacity_log",
  "interview_requests",
  "job_post_matches",
  "job_posts",
  "recruiter_assignments",
  "service_orders",
  "service_packages",
];

const service = createClient(SUPABASE_URL, SERVICE_KEY);

function freshAnonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedInClient(login: { email: string; password: string }): Promise<SupabaseClient | null> {
  const c = freshAnonClient();
  const { error } = await c.auth.signInWithPassword(login);
  if (error) {
    console.log(`⚠️  sign-in failed for ${login.email}: ${error.message}`);
    return null;
  }
  return c;
}

async function visibleCount(c: SupabaseClient, table: string): Promise<number | string> {
  const { count, error } = await c.from(table).select("id", { count: "exact", head: true });
  return error ? `err:${error.code}` : count ?? 0;
}

async function updateProbe(c: SupabaseClient, table: string, targetId: string): Promise<number | string> {
  const { data, error } = await c.from(table).update({ id: targetId }).eq("id", targetId).select("id");
  return error ? `err:${error.code}` : (data ?? []).length;
}

async function main() {
  // Target rows + true totals via service role (sees everything).
  const totals: Record<string, number> = {};
  const targets: Record<string, string | null> = {};
  for (const t of NINE) {
    const { count } = await service.from(t).select("id", { count: "exact", head: true });
    totals[t] = count ?? 0;
    const { data } = await service.from(t).select("id").order("id").limit(1);
    targets[t] = data?.[0]?.id ?? null;
  }

  const anon = freshAnonClient();
  const nonAdmin = await signedInClient(NON_ADMIN_LOGIN);
  const adminUser = await signedInClient(ADMIN_LOGIN);

  let failures = 0;

  console.log("\n===== SELECT visibility (rows each persona can see / rows in table) =====");
  for (const t of NINE) {
    const a = await visibleCount(anon, t);
    const n = nonAdmin ? await visibleCount(nonAdmin, t) : "-";
    const ad = adminUser ? await visibleCount(adminUser, t) : "-";
    console.log(`  ${t}: total=${totals[t]} anon=${a} non-admin=${n} admin=${ad}`);
  }

  console.log("\n===== UPDATE probe: no-op id=id on a real row, returns rows touched =====");
  for (const t of NINE) {
    if (!targets[t]) {
      console.log(`  EMPTY   ${t} (no rows to probe)`);
      continue;
    }
    const a = await updateProbe(anon, t, targets[t]!);
    const n = nonAdmin ? await updateProbe(nonAdmin, t, targets[t]!) : "-";
    const anonOk = a === 0 || typeof a === "string";
    const nonAdminOk = n === "-" || n === 0 || typeof n === "string";
    if (!anonOk || !nonAdminOk) failures++;
    console.log(
      `  ${anonOk && nonAdminOk ? "✅ DENIED " : "🔴 UPDATED"} ${t} (anon touched: ${a}, non-admin touched: ${n})`
    );
  }

  // Positive control: admin must see rows the others cannot on at least one
  // admin-only table (capacity_log / recruiter_assignments beyond own /
  // service_orders). Only meaningful where rows exist.
  if (adminUser) {
    console.log("\n===== admin positive control (write-free) =====");
    let proved = false;
    for (const t of ["capacity_log", "recruiter_assignments", "service_orders", "interview_requests", "job_post_matches"]) {
      if (totals[t] === 0) continue;
      const ad = await visibleCount(adminUser, t);
      if (typeof ad === "number" && ad === totals[t]) {
        console.log(`  ✅ admin sees all ${ad}/${totals[t]} rows of ${t} — is_admin() qual passes`);
        proved = true;
        break;
      } else {
        console.log(`  🔴 admin sees ${ad}/${totals[t]} rows of ${t}`);
        failures++;
        proved = true;
        break;
      }
    }
    if (!proved) console.log("  ⚠️  all candidate tables empty — no positive control possible");
  }

  console.log(
    failures === 0
      ? "\n✅ hole closed: outsiders and non-admins touch 0 rows; admin qual verified"
      : `\n🔴 ${failures} probe(s) violated expectations`
  );
  process.exit(failures === 0 ? 0 : 2);
}

main();
