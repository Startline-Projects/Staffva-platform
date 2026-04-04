import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import crypto from "crypto";

const resend = new Resend(process.env.RESEND_API_KEY);

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

    // Find profile by email
    const { data: profile } = await admin
      .from("profiles")
      .select("id, email, full_name, email_verified, email_verification_sent_at")
      .eq("email", email)
      .single();

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

    // Generate new token
    const token = crypto.randomBytes(32).toString("hex");
    await admin.from("profiles").update({
      email_verification_token: token,
      email_verification_sent_at: new Date().toISOString(),
    }).eq("id", profile.id);

    // Send email
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";
    const verifyUrl = `${siteUrl}/api/auth/verify-email?token=${token}`;
    const firstName = (profile.full_name || "").split(" ")[0] || "there";

    if (process.env.RESEND_API_KEY) {
      await resend.emails.send({
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
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Resend verification error:", error);
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}
