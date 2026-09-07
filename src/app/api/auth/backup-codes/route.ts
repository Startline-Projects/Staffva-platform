import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { BACKUP_CODE_COUNT, generateBackupCode, hashBackupCode } from "@/lib/backupCodes";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * MFA backup codes — generation half. The recovery half lives in
 * /api/auth/recover-mfa (deliberately separate: this route requires a FULL
 * aal2 session, that one is reachable at aal1 because being locked out is
 * its whole point).
 *
 * Only sha256 hashes are stored; the plaintext codes exist exactly once, in
 * this response. Regenerating replaces the whole set — codes belong to an
 * enrollment, not an account, so a fresh set on demand invalidates anything
 * written on an old sticky note.
 */

async function requireAal2Enrolled() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  // Fail CLOSED, same rule as every AAL-checking route: an unreadable AAL is
  // not a satisfied one. currentLevel===nextLevel at aal2 means the session
  // actually passed the TOTP challenge this codes-set will back up.
  if (!aal || aal.currentLevel !== "aal2" || aal.nextLevel !== "aal2") {
    return {
      error: NextResponse.json(
        { error: "Backup codes require an active two-factor session." },
        { status: 403 }
      ),
    };
  }
  return { user };
}

// GET — how many unused codes remain (the security page's "7 of 10 left").
export async function GET() {
  const gate = await requireAal2Enrolled();
  if ("error" in gate) return gate.error;

  const { count, error } = await admin()
    .from("mfa_backup_codes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", gate.user.id)
    .is("used_at", null);
  if (error) {
    return NextResponse.json({ error: "Could not read backup codes." }, { status: 500 });
  }
  return NextResponse.json({ remaining: count ?? 0 });
}

// DELETE — burn the whole set. Called when two-step is turned OFF: backup
// codes are credentials against the enrollment they were minted for, and a
// set that outlives its enrollment silently backs the NEXT one.
export async function DELETE() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { error } = await admin().from("mfa_backup_codes").delete().eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: "Could not remove your backup codes." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// POST — mint a fresh set, replacing any previous one.
export async function POST() {
  const gate = await requireAal2Enrolled();
  if ("error" in gate) return gate.error;
  const db = admin();

  const codes = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);

  // Replace-then-insert, delete first: if the insert fails midway the user
  // has FEWER valid codes, never a stale mixed set that contradicts the
  // "your old codes no longer work" copy.
  const { error: delErr } = await db.from("mfa_backup_codes").delete().eq("user_id", gate.user.id);
  if (delErr) {
    return NextResponse.json({ error: "Could not replace your codes. Try again." }, { status: 500 });
  }
  const { error: insErr } = await db.from("mfa_backup_codes").insert(
    codes.map((c) => ({ user_id: gate.user.id, code_hash: hashBackupCode(c) }))
  );
  if (insErr) {
    return NextResponse.json({ error: "Could not save your codes. Try again." }, { status: 500 });
  }

  return NextResponse.json({ codes });
}
