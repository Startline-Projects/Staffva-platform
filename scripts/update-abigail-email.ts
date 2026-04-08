/**
 * One-off script: Update Abigail's email to abby@glostaffing.com
 * and send her new login info.
 *
 * Run: npx tsx scripts/update-abigail-email.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

// Load .env.local manually since dotenv isn't installed
const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (!process.env[key]) process.env[key] = val;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const OLD_EMAIL = "abbybacon2327@gmail.com"; // current email after last migration
const NEW_EMAIL = "abby@glostaffing.com";
const NAME = "Abigail";
const PASSWORD = "StaffVA@Abigail2026";

async function main() {
  console.log(`Updating ${NAME}'s email from ${OLD_EMAIL} → ${NEW_EMAIL}...`);

  // 1. Find Abigail's profile
  const { data: profile, error: findErr } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("full_name", NAME)
    .single();

  if (findErr || !profile) {
    // Try by old email
    const { data: profile2 } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .eq("email", OLD_EMAIL)
      .single();

    if (!profile2) {
      console.error("Could not find Abigail's profile by name or email.");
      process.exit(1);
    }
    Object.assign(profile!, profile2);
  }

  const userId = (profile as { id: string }).id;
  console.log(`Found profile: ${userId}`);

  // 2. Update auth.users email
  const { error: authErr } = await supabase.auth.admin.updateUserById(userId, {
    email: NEW_EMAIL,
  });
  if (authErr) {
    console.error("Failed to update auth email:", authErr.message);
    process.exit(1);
  }
  console.log("Auth email updated.");

  // 3. Update profiles table
  const { error: profileErr } = await supabase
    .from("profiles")
    .update({ email: NEW_EMAIL })
    .eq("id", userId);
  if (profileErr) {
    console.error("Failed to update profile email:", profileErr.message);
    process.exit(1);
  }
  console.log("Profile email updated.");

  // 4. Reset password to known value
  const { error: pwErr } = await supabase.auth.admin.updateUserById(userId, {
    password: PASSWORD,
  });
  if (pwErr) {
    console.error("Failed to reset password:", pwErr.message);
    process.exit(1);
  }
  console.log("Password reset.");

  // 5. Send credentials email to new address
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "StaffVA <notifications@staffva.com>",
      to: NEW_EMAIL,
      subject: "Your updated StaffVA login — new email",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1C1B1A;">StaffVA</h2>
          <p style="color: #1C1B1A; font-size: 16px;">Hi Abigail,</p>
          <p style="color: #444; font-size: 14px; line-height: 1.6;">
            Your StaffVA recruiter account email has been updated. Here are your new login details:
          </p>
          <div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0 0 8px 0; font-size: 13px; color: #666;"><strong>Login URL:</strong></p>
            <p style="margin: 0 0 12px 0; font-size: 14px;"><a href="https://staffva.com/login" style="color: #FE6E3E;">staffva.com/login</a></p>
            <p style="margin: 0 0 8px 0; font-size: 13px; color: #666;"><strong>Email:</strong></p>
            <p style="margin: 0 0 12px 0; font-size: 14px; color: #1C1B1A;">${NEW_EMAIL}</p>
            <p style="margin: 0 0 8px 0; font-size: 13px; color: #666;"><strong>Temporary password:</strong></p>
            <p style="margin: 0; font-size: 14px; color: #1C1B1A; font-family: monospace; background: #fff; padding: 6px 10px; border-radius: 4px; border: 1px solid #e0e0e0;">${PASSWORD}</p>
          </div>
          <div style="background: #FFF3ED; border: 1px solid #FED7C3; border-radius: 8px; padding: 12px 16px; margin: 20px 0;">
            <p style="margin: 0; font-size: 13px; color: #C2410C;">
              Please log in and change your password as soon as possible using the Forgot Password link on the login page.
            </p>
          </div>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">— The StaffVA Team</p>
        </div>
      `,
    }),
  });

  if (res.ok) {
    console.log(`Credentials email sent to ${NEW_EMAIL}`);
  } else {
    const body = await res.text();
    console.error("Failed to send email:", res.status, body);
  }

  console.log("\nDone. Abigail can now log in at staffva.com/login with:");
  console.log(`  Email: ${NEW_EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
}

main().catch(console.error);
