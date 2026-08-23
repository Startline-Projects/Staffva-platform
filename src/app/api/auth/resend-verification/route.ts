import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
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
    const { email } = await req.json();
    if (!email) return NextResponse.json({ error: "Missing email" }, { status: 400 });

    const admin = getAdminClient();

    // Find profile by email. The lookup error must be distinguished from "no
    // such profile": previously both produced a cheerful "check your email"
    // with nothing sent, so a statement timeout was indistinguishable from a
    // stranger's address and left a real user permanently locked out.
    const { data: profile, error: lookupError } = await admin
      .from("profiles")
      .select("id, email, full_name, email_verified, email_verification_sent_at")
      .eq("email", email)
      .maybeSingle();

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

    // Generate and store the token, but NOT the sent-at stamp. Stamping before
    // the send meant a failed send still started the 60-second rate limit, so
    // the user's instinctive retry returned "rate_limited" and the UI reported
    // success — the one action that could have rescued them was silently
    // swallowed. sent_at is written after the send actually succeeds.
    const token = crypto.randomBytes(32).toString("hex");
    await admin.from("profiles").update({
      email_verification_token: token,
    }).eq("id", profile.id);

    // Send email
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";
    const verifyUrl = `${siteUrl}/api/auth/verify-email?token=${token}`;
    const firstName = (profile.full_name || "").split(" ")[0] || "there";

    // No RESEND_API_KEY guard here on purpose. Skipping the send and still
    // returning success left the account permanently unusable: login signs
    // the user back out until email_verified is true, and the only writer of
    // that is the link inside this email. sendEmail() throws when the key is
    // missing or Resend rejects, which the catch below turns into a 500 the
    // signup page now surfaces.
    await sendEmail({
      from: "StaffVA <notifications@staffva.com>",
      to: profile.email,
      subject: "Verify your StaffVA account",
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
          <h2 style="color:#1C1B1A;">Verify your email</h2>
          <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
          <p style="color:#444;font-size:14px;">Thank you for signing up for StaffVA. Please click the button below to verify your email address and activate your account.</p>
          <a href="${verifyUrl}" style="display:inline-block;background:#FE6E3E;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;font-size:14px;">Verify My Email</a>
          <p style="color:#999;margin-top:24px;font-size:12px;">If you didn't create an account, you can safely ignore this email.</p>
          <p style="color:#999;font-size:12px;">— The StaffVA Team</p>
        </div>`,
    });

    // Only now start the resend cooldown, since a mail actually went out.
    await admin
      .from("profiles")
      .update({ email_verification_sent_at: new Date().toISOString() })
      .eq("id", profile.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Resend verification error:", error);
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}
