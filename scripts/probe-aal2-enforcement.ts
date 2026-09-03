/**
 * Probe migration 00161 (MFA-aware aal2 RLS enforcement) through the REAL
 * PostgREST stack, since exec_sql cannot impersonate (SET ROLE is blocked
 * inside SECURITY DEFINER — see probe-admin-policy-hole.ts).
 *
 * Three states, same probes, seeded test accounts:
 *   1. No verified factor (test-admin-eng as seeded): everything behaves
 *      exactly as before the migration — the gate must not bind users who
 *      never enrolled. This is the "signup/apply/dashboard still work"
 *      control: it exercises the identical mfa_satisfied() predicate every
 *      ungated flow evaluates.
 *   2. Verified factor + aal1 token (test-admin-eng after an in-script
 *      TOTP enrollment, then a FRESH password-only sign-in): the attacker
 *      scenario. Gated reads return 0 rows; gated INSERT errors on the
 *      restrictive WITH CHECK; gated UPDATE/DELETE touch 0 rows.
 *   3. Verified factor + aal2 token (complete the TOTP challenge
 *      in-script): everything from state 1 works again.
 *
 * Probes:
 *   - READ : count of ai_interviews visible to admin (58 rows live; the
 *            table is FOR-ALL gated and admin holds a scoped SELECT).
 *            Ground truth via service role.
 *   - WRITE: a throwaway capacity_log row (write-gated, is_admin() ALL
 *            policy, INSERT+UPDATE grants intact) cycled INSERT → UPDATE →
 *            DELETE, so no real data is ever touched. Earlier attempt
 *            no-op-updated profiles and learned 42501 the hard way:
 *            00159 revoked profiles' UPDATE grant, so that write dies at
 *            the GRANT layer in every state and proves nothing about
 *            policies. capacity_log kept INSERT+UPDATE — but not DELETE,
 *            so the DELETE leg is expected to 42501 in EVERY state (the
 *            pre-00161 grant posture; the restrictive DELETE policy sits
 *            behind that revoke as defense-in-depth, same predicate as
 *            the INSERT/UPDATE gates this probe does prove).
 *   - Plus: recruiter (never enrolled) reads own profiles row — ungated
 *            reads unaffected throughout.
 *
 * The enrolled factor is removed in a finally block (user unenroll at
 * aal2, service-role admin deleteFactor as fallback) so the seeded admin
 * account is never left locked behind a throwaway TOTP secret. Probe rows
 * are tagged in action_taken and swept by the service role at the end.
 *
 * Run: npx tsx --env-file=.env.local scripts/probe-aal2-enforcement.ts
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mshnsbblwgcpwuxwuevp.supabase.co";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!ANON_KEY || !SERVICE_KEY) {
  console.error("❌ need NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Seeded by scripts/seed-test-engineer-accounts.ts (committed test fixtures).
const ADMIN_LOGIN = { email: "test-admin-eng@staffva.com", password: "TestAdmin2026!" };
const RECRUITER_LOGIN = { email: "test-recruiter-eng@staffva.com", password: "TestRecruiter2026!" };

const PROBE_TAG = "aal2-probe (throwaway row — safe to delete)";

const service = createClient(SUPABASE_URL, SERVICE_KEY);

function freshClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── RFC 6238 TOTP (SHA1, 30s, 6 digits) so the script can pass the challenge ──
function base32Decode(s: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, "0");
}

let enrolledSecret: string | null = null;

async function verifyTotp(c: SupabaseClient, factorId: string): Promise<void> {
  const { data: challenge, error: chErr } = await c.auth.mfa.challenge({ factorId });
  if (chErr || !challenge) throw new Error(`challenge failed: ${chErr?.message}`);
  const secret = enrolledSecret!;
  let { error: vErr } = await c.auth.mfa.verify({ factorId, challengeId: challenge.id, code: totp(secret) });
  if (vErr) {
    // Clock-edge retry with the next window's code.
    const { data: ch2 } = await c.auth.mfa.challenge({ factorId });
    ({ error: vErr } = await c.auth.mfa.verify({ factorId, challengeId: ch2!.id, code: totp(secret, Date.now() + 30_000) }));
    if (vErr) throw new Error(`TOTP verify failed twice: ${vErr.message}`);
  }
}

// ── probes ──
async function readProbe(c: SupabaseClient, table: string): Promise<number | string> {
  const { count, error } = await c.from(table).select("id", { count: "exact", head: true });
  return error ? `err:${error.code}` : count ?? 0;
}

/** Full write cycle on capacity_log. Returns per-step outcome strings. */
async function writeCycle(c: SupabaseClient, candidateId: string) {
  const ins = await c
    .from("capacity_log")
    .insert({ candidate_id: candidateId, previous_hours: 0, new_hours: 0, action_taken: PROBE_TAG })
    .select("id");
  const insertOutcome = ins.error ? `err:${ins.error.code}` : (ins.data ?? []).length;
  const rowId = ins.data?.[0]?.id as string | undefined;

  let updateOutcome: number | string = "skipped";
  let deleteOutcome: number | string = "skipped";
  if (rowId) {
    const upd = await c.from("capacity_log").update({ new_hours: 1 }).eq("id", rowId).select("id");
    updateOutcome = upd.error ? `err:${upd.error.code}` : (upd.data ?? []).length;
    const del = await c.from("capacity_log").delete().eq("id", rowId).select("id");
    deleteOutcome = del.error ? `err:${del.error.code}` : (del.data ?? []).length;
  }
  return { insertOutcome, updateOutcome, deleteOutcome };
}

async function aalOf(c: SupabaseClient): Promise<string> {
  const { data } = await c.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel ?? "?";
}

async function main() {
  let failures = 0;
  const expect = (label: string, actual: number | string, want: number | string | "denied") => {
    const ok = want === "denied" ? actual === 0 || String(actual).startsWith("err:") : actual === want;
    if (!ok) failures++;
    console.log(`  ${ok ? "✅" : "🔴"} ${label}: got ${actual}${want === "denied" ? " (denied as expected)" : `, want ${want}`}`);
  };
  // capacity_log has no DELETE grant for authenticated (00159), so the
  // user-client DELETE leg 42501s in every state — asserted as such.
  const GRANT_DENIED = "err:42501";

  // Ground truth + a candidate id for the throwaway rows, via service role.
  const { count: aiTotal } = await service.from("ai_interviews").select("id", { count: "exact", head: true });
  const { data: anyCandidate } = await service.from("candidates").select("id").limit(1);
  const candidateId = anyCandidate?.[0]?.id as string | undefined;
  if (!aiTotal || !candidateId) throw new Error(`need ground truth: ai_interviews=${aiTotal}, candidate=${candidateId}`);
  console.log(`ground truth: ai_interviews=${aiTotal}, probe candidate_id=${candidateId}`);

  // ── state 1: no factor — the gate must not bind ──
  console.log("\n===== state 1: no verified factor (non-MFA users unaffected) =====");
  const recruiter = freshClient();
  {
    const { data, error } = await recruiter.auth.signInWithPassword(RECRUITER_LOGIN);
    if (error || !data.user) throw new Error(`recruiter sign-in failed: ${error?.message}`);
    const { count } = await recruiter.from("profiles").select("id", { count: "exact", head: true }).eq("id", data.user.id);
    expect(`recruiter (aal=${await aalOf(recruiter)}) reads own profiles row`, count ?? 0, 1);
  }
  const admin1 = freshClient();
  const { data: adminSignin, error: adminErr } = await admin1.auth.signInWithPassword(ADMIN_LOGIN);
  if (adminErr || !adminSignin.user) throw new Error(`admin sign-in failed: ${adminErr?.message}`);
  const adminId = adminSignin.user.id;
  console.log(`  admin aal=${await aalOf(admin1)}`);
  expect("admin sees all ai_interviews rows", await readProbe(admin1, "ai_interviews"), aiTotal);
  {
    const w = await writeCycle(admin1, candidateId);
    expect("admin INSERT throwaway capacity_log row", w.insertOutcome, 1);
    expect("admin UPDATE that row", w.updateOutcome, 1);
    expect("admin DELETE 42501s (pre-existing grant revoke, not the gate)", w.deleteOutcome, GRANT_DENIED);
  }

  // ── enroll a throwaway TOTP factor on the admin account ──
  console.log("\n===== enrolling throwaway TOTP factor on test-admin-eng =====");
  const { data: enrollment, error: enrollErr } = await admin1.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "aal2-probe-throwaway",
  });
  if (enrollErr || !enrollment) throw new Error(`enroll failed: ${enrollErr?.message}`);
  const factorId = enrollment.id;
  enrolledSecret = (enrollment as { totp: { secret: string } }).totp.secret;

  try {
    await verifyTotp(admin1, factorId); // verifies the factor AND upgrades this session to aal2
    console.log(`  factor verified; enrolling session now aal=${await aalOf(admin1)}`);

    // ── state 3 first (this session is already aal2): everything works ──
    console.log("\n===== state 3: verified factor + aal2 token (gate passes) =====");
    expect("aal2 admin sees all ai_interviews rows", await readProbe(admin1, "ai_interviews"), aiTotal);
    {
      const w = await writeCycle(admin1, candidateId);
      expect("aal2 INSERT", w.insertOutcome, 1);
      expect("aal2 UPDATE", w.updateOutcome, 1);
      expect("aal2 DELETE 42501s (pre-existing grant revoke)", w.deleteOutcome, GRANT_DENIED);
    }

    // ── state 2: fresh password-only sign-in = the attacker's aal1 token ──
    console.log("\n===== state 2: verified factor + aal1 token (attacker scenario) =====");
    const attacker = freshClient();
    const { error: atkErr } = await attacker.auth.signInWithPassword(ADMIN_LOGIN);
    if (atkErr) throw new Error(`attacker sign-in failed: ${atkErr.message}`);
    console.log(`  password-only session aal=${await aalOf(attacker)}`);
    expect("aal1 read of ai_interviews DENIED", await readProbe(attacker, "ai_interviews"), 0);
    {
      const w = await writeCycle(attacker, candidateId);
      expect("aal1 INSERT DENIED", w.insertOutcome, "denied");
      // INSERT was denied, so there is no row of ours; probe UPDATE/DELETE
      // against a service-role-planted row instead.
      const { data: planted } = await service
        .from("capacity_log")
        .insert({ candidate_id: candidateId, previous_hours: 0, new_hours: 0, action_taken: PROBE_TAG })
        .select("id");
      const plantedId = planted?.[0]?.id as string;
      const upd = await attacker.from("capacity_log").update({ new_hours: 2 }).eq("id", plantedId).select("id");
      expect("aal1 UPDATE DENIED (0 rows touched)", upd.error ? `err:${upd.error.code}` : (upd.data ?? []).length, "denied");
      const del = await attacker.from("capacity_log").delete().eq("id", plantedId).select("id");
      expect("aal1 DELETE DENIED (0 rows touched)", del.error ? `err:${del.error.code}` : (del.data ?? []).length, "denied");
      console.log(`  (write-cycle outcomes at aal1: insert=${w.insertOutcome} update=${w.updateOutcome} delete=${w.deleteOutcome})`);
    }

    // Completing the challenge on that same session must restore access —
    // proving a legit MFA login (not just the enrolling session) passes.
    await verifyTotp(attacker, factorId);
    console.log(`  challenge completed; session now aal=${await aalOf(attacker)}`);
    expect("post-challenge read restored", await readProbe(attacker, "ai_interviews"), aiTotal);
    {
      const w = await writeCycle(attacker, candidateId);
      expect("post-challenge INSERT restored", w.insertOutcome, 1);
      expect("post-challenge UPDATE restored", w.updateOutcome, 1);
      expect("post-challenge DELETE 42501s (pre-existing grant revoke)", w.deleteOutcome, GRANT_DENIED);
    }
  } finally {
    // Leave the seeded account exactly as we found it, no matter what failed.
    console.log("\n===== cleanup =====");
    const { error: unenrollErr } = await admin1.auth.mfa.unenroll({ factorId });
    if (unenrollErr) {
      console.log(`  user unenroll failed (${unenrollErr.message}); falling back to admin deleteFactor`);
      const { error: delErr } = await service.auth.admin.mfa.deleteFactor({ id: factorId, userId: adminId });
      if (delErr) {
        console.log(`  🔴 CLEANUP FAILED: factor ${factorId} still on ${ADMIN_LOGIN.email} — delete it manually!`);
        failures++;
      } else {
        console.log("  ✅ factor removed via service-role admin API");
      }
    } else {
      console.log("  ✅ factor removed via user unenroll");
    }

    // Sweep any probe rows that survived a mid-cycle failure.
    const { data: swept } = await service.from("capacity_log").delete().eq("action_taken", PROBE_TAG).select("id");
    console.log(`  swept ${swept?.length ?? 0} leftover probe row(s) from capacity_log`);

    // Count remaining factors through the exec_sql RAISE channel (auth
    // schema is not exposed over PostgREST) — must be back to zero.
    const { data: cnt, error: cntErr } = await service.rpc("exec_sql", {
      query: `do $audit$ declare r text; begin
        select 'factors=' || count(*) into r from auth.mfa_factors;
        raise exception using message = '<<<' || r || '>>>';
      end $audit$;`,
    });
    const msg = (cntErr?.message ?? (cnt as { error?: string })?.error ?? "").match(/<<<([\s\S]*)>>>/);
    console.log(`  auth.mfa_factors after cleanup: ${msg ? msg[1] : "(unreadable)"}`);
    if (msg && msg[1] !== "factors=0") failures++;
  }

  console.log(
    failures === 0
      ? "\n✅ aal2 enforcement verified: non-MFA users unaffected, aal1-with-factor denied, aal2 restored"
      : `\n🔴 ${failures} probe(s) violated expectations`
  );
  process.exit(failures === 0 ? 0 : 2);
}

main().catch((e) => {
  console.error("💥 probe crashed:", e);
  process.exit(3);
});
