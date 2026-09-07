import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { verifyBackupCode } from "@/lib/backupCodes";
import { notifyCandidate } from "@/lib/notifyCandidate";
import { sendEmail } from "@/lib/email";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * The lost-authenticator door. Before this route, an enrolled user who lost
 * their phone was fully locked out: middleware bounces their aal1 session
 * everywhere, PostgREST is closed by the 00161 restrictive policies, and
 * password reset itself challenges TOTP first.
 *
 * Reachable at aal1 ON PURPOSE — the caller is exactly the person stuck at
 * the TOTP screen with a password-verified half-session. The defenses are:
 * password login already happened (getUser), 5 attempts/hour, single-use
 * codes consumed by CAS, and only hashes at rest.
 *
 * On success every verified TOTP factor is deleted (this is what unlocks the
 * account: mfa_satisfied() flips true for a factor-less user, and middleware
 * stops demanding aal2) and ALL remaining backup codes are burned — they
 * belonged to the dead enrollment. The response tells the user to set 2FA up
 * again.
 */
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in with your password first, then use your backup code." },
      { status: 401 }
    );
  }

  const limited = await enforceRateLimit(`mfa-recovery:${user.id}`, LIMITS.mfaRecovery);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code.trim() : "";
  // 8 chars + optional separator; anything else can't be one of ours.
  if (code.length < 8 || code.length > 12) {
    return NextResponse.json({ error: "That doesn't look like a backup code." }, { status: 400 });
  }

  const db = admin();

  // Salted scrypt digests can't be looked up by value — fetch the user's
  // unused rows (≤10) and verify each. Then consume-by-CAS on the row id:
  // the UPDATE only lands on a still-unused row, so the same code pasted in
  // two tabs burns once and succeeds once.
  const { data: rows, error: rowsErr } = await db
    .from("mfa_backup_codes")
    .select("id, code_hash")
    .eq("user_id", user.id)
    .is("used_at", null);
  if (rowsErr) {
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
  const match = (rows ?? []).find((r) => verifyBackupCode(code, r.code_hash));
  let consumed: { id: string } | null = null;
  if (match) {
    const { data: burned, error: consumeErr } = await db
      .from("mfa_backup_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("id", match.id)
      .is("used_at", null)
      .select("id")
      .maybeSingle();
    if (consumeErr) {
      return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
    }
    consumed = burned;
  }
  if (!consumed) {
    // One message for wrong, already-used, and never-existed — a
    // distinguishable "used" answer would confirm code validity to a guesser.
    return NextResponse.json(
      { error: "That code didn't work. Each code can be used once — try another from your list." },
      { status: 400 }
    );
  }

  // The unlock: remove the verified TOTP factors. auth.admin lists factors
  // per user; delete each TOTP one. Any failure here after the code burned
  // must be LOUD — the user spent a code and is still locked out.
  const { data: factorData, error: listErr } = await db.auth.admin.mfa.listFactors({
    userId: user.id,
  });
  if (listErr) {
    return NextResponse.json(
      { error: "Your code was valid but we couldn't reach your account's factors. Contact support@staffva.com." },
      { status: 500 }
    );
  }
  const totpFactors = (factorData?.factors ?? []).filter((f) => f.factor_type === "totp");
  for (const f of totpFactors) {
    const { error: delErr } = await db.auth.admin.mfa.deleteFactor({ id: f.id, userId: user.id });
    if (delErr) {
      return NextResponse.json(
        { error: "Your code was valid but removing the old authenticator failed. Contact support@staffva.com." },
        { status: 500 }
      );
    }
  }

  // Burn the rest of the set — it backed the enrollment that just died.
  await db.from("mfa_backup_codes").delete().eq("user_id", user.id);

  // TELL THE OWNER. Removing 2FA is the one account change its rightful
  // owner must hear about — if this wasn't them, this is their only alarm.
  // Candidates hear via the bell (their email is frozen; 'system' finally
  // has a sender); everyone else gets an email.
  const role = user.app_metadata?.role;
  try {
    if (role === "candidate") {
      const { data: cand } = await db
        .from("candidates")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cand) {
        await notifyCandidate(db, {
          candidateId: cand.id,
          category: "system",
          title: "Two-step verification was removed from your account",
          body: "A backup code was used at sign-in. If this was you, set up a new authenticator from Account → Security. If it wasn't, change your password now and contact support@staffva.com.",
          route: "/account/security",
        });
      }
    } else if (user.email) {
      await sendEmail(
        {
          from: "StaffVA <notifications@staffva.com>",
          to: user.email,
          subject: "Two-step verification was removed from your StaffVA account",
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">Two-step verification removed</h2>
            <p style="color:#444;font-size:14px;">A backup code was used to sign in to your account, which removes the lost authenticator. If this was you, set up a new authenticator from Account &rarr; Security. If it wasn't, change your password immediately and contact support@staffva.com.</p>
          </div>`,
        },
        { recipientKind: role === "client" ? "client" : "staff", emailType: "mfa_removed" }
      );
    }
  } catch {
    // The recovery itself succeeded; the alert is best-effort and the
    // account owner can still see the change on the security page.
  }

  return NextResponse.json({
    success: true,
    message:
      "Two-factor has been removed from your account. Sign-in will work with your password alone — set up a new authenticator from Account → Security as soon as you can.",
  });
}
