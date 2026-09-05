import { NextRequest, NextResponse } from "next/server";
import { enqueueEmail } from "@/lib/emailOutbox";
import { enforceRateLimit, clientIp, LIMITS } from "@/lib/rateLimit";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * POST /api/auth/resend-verification
 * Body: { email }
 * Resends the verification email
 */
export async function POST(req: NextRequest) {
  try {
    const { email, token: byToken } = await req.json();
    if (!email && !byToken) return NextResponse.json({ error: "Missing email" }, { status: 400 });

    // A raw request ceiling only, set far above any real NAT cohort. This must
    // never be what stops a legitimate signup: the account is already created
    // by the time this route is called, and if no email is queued the user can
    // never log in. The precise limit is per account, further down.
    const ipLimited = await enforceRateLimit(
      `verification:ip:${clientIp(req)}`,
      LIMITS.verificationEmailIp
    );
    if (ipLimited) return ipLimited;

    const admin = getAdminClient();

    // Find profile by email. The lookup error must be distinguished from "no
    // such profile": previously both produced a cheerful "check your email"
    // with nothing sent, so a statement timeout was indistinguishable from a
    // stranger's address and left a real user permanently locked out.
    // Lookup by email, or — for the verify page's expired/invalid states —
    // by the token itself, so the account email never has to cross the wire.
    let lookup = admin
      .from("profiles")
      .select("id, email, full_name, email_verified, email_verification_sent_at");
    if (email) {
      lookup = lookup.eq("email", email);
    } else {
      if (typeof byToken !== "string" || !/^[a-f0-9]{64}$/.test(byToken)) {
        return NextResponse.json({ success: true });
      }
      lookup = lookup.eq("email_verification_token", byToken);
    }
    const { data: profile, error: lookupError } = await lookup.maybeSingle();

    if (lookupError) {
      return NextResponse.json({ error: "Could not send verification email" }, { status: 500 });
    }

    if (!profile) {
      // Don't reveal if email exists
      return NextResponse.json({ success: true });
    }

    if (profile.email_verified) {
      return NextResponse.json({ success: true, message: "already_verified" });
    }

    // Rate limit: max 1 resend per 60 seconds
    if (profile.email_verification_sent_at) {
      const sentAt = new Date(profile.email_verification_sent_at).getTime();
      if (Date.now() - sentAt < 60000) {
        return NextResponse.json({ success: true, message: "rate_limited" });
      }
    }

    // Per-account bound, checked only now — after the lookup and the cooldown
    // — so probes for unknown addresses and requests inside the cooldown can
    // never consume a real user's budget.
    const accountLimited = await enforceRateLimit(
      `verification:acct:${profile.id}`,
      LIMITS.verificationEmailAccount
    );
    if (accountLimited) return accountLimited;

    // The token update's error must not be discarded: supabase-js resolves
    // with errors rather than throwing, so a statement timeout here would
    // queue a real-looking email whose link can never work.
    // sent_at rides in the same write as the token: the 24h expiry check
    // reads it, and a silently-failed follow-up write left a FRESH link
    // judged by a stale timestamp — expired on arrival, unrecoverable.
    const token = crypto.randomBytes(32).toString("hex");
    const { error: tokenError } = await admin.from("profiles").update({
      email_verification_token: token,
      email_verification_sent_at: new Date().toISOString(),
    }).eq("id", profile.id);

    if (tokenError) {
      return NextResponse.json({ error: "Could not send verification email" }, { status: 500 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";
    const verifyUrl = `${siteUrl}/verify-email?token=${token}`;
    const firstName = (profile.full_name || "").split(" ")[0] || "there";

    // Queued, not sent inline. This is the one email whose failure is
    // unrecoverable — login signs the user straight back out until
    // email_verified is true, and the only writer of that flag is the link
    // below — so it must not depend on Resend being reachable and under its
    // rate limit at the exact moment somebody signs up. The drain cron sends
    // it within about a minute, with retries and backoff.
    //
    // enqueueEmail throws if the row cannot be written, which is a real
    // failure the signup page surfaces. It does NOT throw on a duplicate
    // dedupe_key: the message is already queued, which is what was wanted.
    await enqueueEmail({
      to: profile.email,
      subject: "Verify your StaffVA account",
      recipientKind: "candidate",
      emailType: "email_verification",
      dedupeKey: `verification:${token}`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
          <h2 style="color:#1C1B1A;">Verify your email</h2>
          <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
          <p style="color:#444;font-size:14px;">Thank you for signing up for StaffVA. Please click the button below to verify your email address and activate your account.</p>
          <a href="${verifyUrl}" style="display:inline-block;background:#FE6E3E;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;font-size:14px;">Verify My Email</a>
          <p style="color:#999;margin-top:24px;font-size:12px;">If you didn't create an account, you can safely ignore this email.</p>
          <p style="color:#999;font-size:12px;">— The StaffVA Team</p>
        </div>`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Resend verification error:", error);
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}
