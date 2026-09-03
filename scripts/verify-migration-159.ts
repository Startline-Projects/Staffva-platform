/**
 * Verify migration 00159 — behavioral probes over PostgREST.
 *
 * Every DELETE probe filters on a UUID that cannot exist, so a granted
 * privilege shows up as "success, 0 rows" and a revoked one as SQLSTATE
 * 42501 — no data is ever touched. Uses the standing test recruiter
 * account (scripts/seed-test-engineer-accounts.ts) for authenticated
 * probes; any authenticated role proves the grant layer, since the
 * no-match filter neutralizes RLS row-matching.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-migration-159.ts
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mshnsbblwgcpwuxwuevp.supabase.co";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!ANON_KEY) {
  console.error("❌ NEXT_PUBLIC_SUPABASE_ANON_KEY not found in environment");
  process.exit(1);
}

const NO_MATCH = "00000000-0000-0000-0000-000000000000";
const TEST_RECRUITER = { email: "test-recruiter-eng@staffva.com", password: "TestRecruiter2026!" };

let failures = 0;
function report(label: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label} — ${detail}`);
  if (!ok) failures++;
}

async function main() {
  // ── anon probes ────────────────────────────────────────────────
  console.log("\n1. anon role");
  const anon = createClient(SUPABASE_URL, ANON_KEY!);

  {
    // job_post_matches has the USING(true) admin policy; before 00159 this
    // request could delete real rows. Must now be permission denied.
    const { error } = await anon.from("job_post_matches").delete().eq("id", NO_MATCH);
    report("DELETE job_post_matches revoked", !!error && error.code === "42501",
      error ? `${error.code} ${error.message}` : "unexpectedly allowed");
  }
  {
    const { error } = await anon.from("waitlist_users").delete().eq("id", NO_MATCH);
    report("DELETE waitlist_users revoked", !!error && error.code === "42501",
      error ? `${error.code} ${error.message}` : "unexpectedly allowed");
  }
  {
    // public browse reads must keep working
    const { data, error } = await anon.from("tenure_badges").select("id").limit(1);
    report("SELECT tenure_badges still allowed", !error, error ? error.message : `${data?.length ?? 0} row(s)`);
  }
  {
    const { data, error } = await anon.from("reviews").select("id").limit(1);
    report("SELECT reviews still allowed", !error, error ? error.message : `${data?.length ?? 0} row(s)`);
  }

  // ── authenticated probes ──────────────────────────────────────
  console.log("\n2. authenticated role (test recruiter login)");
  const authed = createClient(SUPABASE_URL, ANON_KEY!);
  const { data: session, error: loginError } = await authed.auth.signInWithPassword(TEST_RECRUITER);
  report("login works", !loginError && !!session?.user, loginError ? loginError.message : session!.user.email!);
  if (loginError) {
    console.log(`\n${failures} failure(s)`);
    process.exit(1);
  }

  {
    const { data, error } = await authed.from("profiles").select("id,role").eq("id", session!.user.id);
    report("SELECT own profile works", !error && (data?.length ?? 0) === 1,
      error ? error.message : `role=${data?.[0]?.role}`);
  }
  {
    const { data, error } = await authed.from("platform_settings").select("*").limit(1);
    report("SELECT platform_settings works", !error, error ? error.message : `${data?.length ?? 0} row(s)`);
  }
  {
    // kept grant: scoped delete policy exists (candidate manages own availability)
    const { error } = await authed.from("candidate_availability").delete().eq("id", NO_MATCH);
    report("DELETE candidate_availability still granted", !error, error ? `${error.code} ${error.message}` : "ok (0 rows)");
  }
  {
    // kept grant: recruiters manage their messages
    const { error } = await authed.from("recruiter_messages").delete().eq("id", NO_MATCH);
    report("DELETE recruiter_messages still granted", !error, error ? `${error.code} ${error.message}` : "ok (0 rows)");
  }
  {
    // revoked: USING(true) admin policy, no scoped delete path
    const { error } = await authed.from("capacity_log").delete().eq("id", NO_MATCH);
    report("DELETE capacity_log revoked", !!error && error.code === "42501",
      error ? `${error.code} ${error.message}` : "unexpectedly allowed");
  }
  {
    // revoked: no delete policy at all
    const { error } = await authed.from("messages").delete().eq("id", NO_MATCH);
    report("DELETE messages revoked", !!error && error.code === "42501",
      error ? `${error.code} ${error.message}` : "unexpectedly allowed");
  }
  {
    // UPDATE with a no-match filter must still be granted (scope untouched)
    const { error } = await authed.from("messages").update({ read_at: new Date().toISOString() }).eq("id", NO_MATCH);
    report("UPDATE messages still granted", !error, error ? `${error.code} ${error.message}` : "ok (0 rows)");
  }

  await authed.auth.signOut();
  console.log(`\n${failures === 0 ? "✅ all probes passed" : `❌ ${failures} failure(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
