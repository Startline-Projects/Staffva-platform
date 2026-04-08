/**
 * One-off script: Send Leyan her recruiter login credentials to ops@glostaffing.com
 * Run: npx tsx scripts/send-leyan-credentials.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local
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

async function main() {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "StaffVA <notifications@staffva.com>",
      to: "ops@glostaffing.com",
      subject: "Your StaffVA recruiter login credentials",
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="color:#1C1B1A;">StaffVA</h2>
        <p style="color:#1C1B1A;font-size:16px;">Hi Leyan,</p>
        <p style="color:#444;font-size:14px;line-height:1.6;">
          Your StaffVA recruiter account is ready. Here are your login details:
        </p>
        <div style="background:#f9f9f9;border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin:20px 0;">
          <p style="margin:0 0 8px 0;font-size:13px;color:#666;"><strong>Login URL:</strong></p>
          <p style="margin:0 0 12px 0;font-size:14px;"><a href="https://staffva.com/login" style="color:#FE6E3E;">staffva.com/login</a></p>
          <p style="margin:0 0 8px 0;font-size:13px;color:#666;"><strong>Email:</strong></p>
          <p style="margin:0 0 12px 0;font-size:14px;color:#1C1B1A;">ops@glostaffing.com</p>
          <p style="margin:0 0 8px 0;font-size:13px;color:#666;"><strong>Temporary password:</strong></p>
          <p style="margin:0;font-size:14px;color:#1C1B1A;font-family:monospace;background:#fff;padding:6px 10px;border-radius:4px;border:1px solid #e0e0e0;">StaffVA@Leyan2026</p>
        </div>
        <div style="background:#FFF3ED;border:1px solid #FED7C3;border-radius:8px;padding:12px 16px;margin:20px 0;">
          <p style="margin:0;font-size:13px;color:#C2410C;">
            Please log in and change your password as soon as possible using the Forgot Password link on the login page.
          </p>
        </div>
        <p style="color:#444;font-size:14px;line-height:1.6;">
          Your dashboard shows candidates assigned to your role categories. You can view full profiles, test scores, and recordings.
        </p>
        <p style="color:#999;font-size:12px;margin-top:24px;">— The StaffVA Team</p>
      </div>`,
    }),
  });

  if (res.ok) {
    console.log("Credentials email sent to ops@glostaffing.com for Leyan");
  } else {
    console.error("Failed:", res.status, await res.text());
  }
}

main().catch(console.error);
