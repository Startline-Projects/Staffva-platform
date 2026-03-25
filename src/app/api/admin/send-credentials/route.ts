import { NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const ACCOUNTS = [
  { email: "sam@glostaffing.com", name: "Sam", role: "admin", password: "StaffVA@Admin2026" },
  { email: "careers@globalstaffing.asia", name: "Manar", role: "recruiter", password: "StaffVA@Manar2026" },
  { email: "hr@glostaffing.com", name: "Ranim", role: "recruiter", password: "StaffVA@Ranim2026" },
  { email: "support@glostaffing.com", name: "Jerome", role: "recruiter", password: "StaffVA@Jerome2026" },
  { email: "ops@glostaffing.com", name: "Abigail", role: "recruiter", password: "StaffVA@Abigail2026" },
  { email: "marketing@glostaffing.com", name: "Shelly", role: "recruiter", password: "StaffVA@Shelly2026" },
  { email: "zak@glostaffing.com", name: "Ibraheem", role: "recruiter", password: "StaffVA@Ibraheem2026" },
  { email: "info@glostaffing.com", name: "Eslam", role: "recruiter", password: "StaffVA@Eslam2026" },
];

export async function POST() {
  try {
    const results: { email: string; status: string; error?: string }[] = [];

    // Send individual credential emails
    for (const account of ACCOUNTS) {
      try {
        await resend.emails.send({
          from: "StaffVA <notifications@staffva.com>",
          to: account.email,
          subject: "Your StaffVA recruiter access is ready",
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <h2 style="color: #1C1B1A; margin: 0;">StaffVA</h2>
              </div>

              <p style="color: #1C1B1A; font-size: 16px;">Hi ${account.name},</p>

              <p style="color: #444; font-size: 14px; line-height: 1.6;">
                Your StaffVA ${account.role} account has been created.
              </p>

              <div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="margin: 0 0 8px 0; font-size: 13px; color: #666;"><strong>Login URL:</strong></p>
                <p style="margin: 0 0 12px 0; font-size: 14px;"><a href="https://staffva.com/login" style="color: #FE6E3E;">staffva.com/login</a></p>

                <p style="margin: 0 0 8px 0; font-size: 13px; color: #666;"><strong>Email:</strong></p>
                <p style="margin: 0 0 12px 0; font-size: 14px; color: #1C1B1A;">${account.email}</p>

                <p style="margin: 0 0 8px 0; font-size: 13px; color: #666;"><strong>Temporary password:</strong></p>
                <p style="margin: 0; font-size: 14px; color: #1C1B1A; font-family: monospace; background: #fff; padding: 6px 10px; border-radius: 4px; border: 1px solid #e0e0e0;">${account.password}</p>
              </div>

              <div style="background: #FFF3ED; border: 1px solid #FED7C3; border-radius: 8px; padding: 12px 16px; margin: 20px 0;">
                <p style="margin: 0; font-size: 13px; color: #C2410C;">
                  ⚠️ Please log in and change your password immediately using the <strong>Account</strong> menu in the top right.
                </p>
              </div>

              <p style="color: #444; font-size: 14px; line-height: 1.6;">
                Your dashboard shows candidates assigned to your role categories. You can view full profiles, test scores, and recordings.
              </p>

              <p style="color: #444; font-size: 14px; line-height: 1.6;">
                Reach out to Ahmed if you have any questions.
              </p>

              <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;" />

              <p style="color: #999; font-size: 12px; text-align: center;">
                StaffVA — Pre-vetted offshore professionals for U.S. businesses
              </p>
            </div>
          `,
        });
        results.push({ email: account.email, status: "sent" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        results.push({ email: account.email, status: "failed", error: message });
      }
    }

    // Send summary email to Sam
    const summaryRows = ACCOUNTS.map(
      (a) => `<tr>
        <td style="padding: 6px 12px; border-bottom: 1px solid #eee; font-size: 13px;">${a.name}</td>
        <td style="padding: 6px 12px; border-bottom: 1px solid #eee; font-size: 13px;">${a.email}</td>
        <td style="padding: 6px 12px; border-bottom: 1px solid #eee; font-size: 13px; font-family: monospace;">${a.password}</td>
        <td style="padding: 6px 12px; border-bottom: 1px solid #eee; font-size: 13px;">${a.role}</td>
      </tr>`
    ).join("");

    try {
      await resend.emails.send({
        from: "StaffVA <notifications@staffva.com>",
        to: "sam@glostaffing.com",
        subject: "StaffVA — All recruiter accounts created",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 700px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1C1B1A;">StaffVA Account Summary</h2>
            <p style="color: #444; font-size: 14px;">All recruiter and admin accounts have been created. Here are the details:</p>

            <table style="width: 100%; border-collapse: collapse; margin: 20px 0; border: 1px solid #e0e0e0; border-radius: 8px;">
              <thead>
                <tr style="background: #f9f9f9;">
                  <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #666; border-bottom: 2px solid #e0e0e0;">Name</th>
                  <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #666; border-bottom: 2px solid #e0e0e0;">Email</th>
                  <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #666; border-bottom: 2px solid #e0e0e0;">Temp Password</th>
                  <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #666; border-bottom: 2px solid #e0e0e0;">Role</th>
                </tr>
              </thead>
              <tbody>
                ${summaryRows}
              </tbody>
            </table>

            <p style="color: #444; font-size: 14px;">
              Login URL: <a href="https://staffva.com/login" style="color: #FE6E3E;">staffva.com/login</a>
            </p>

            <div style="background: #FFF3ED; border: 1px solid #FED7C3; border-radius: 8px; padding: 12px 16px; margin: 20px 0;">
              <p style="margin: 0; font-size: 13px; color: #C2410C;">
                All users have been asked to change their passwords on first login.
              </p>
            </div>
          </div>
        `,
      });
      results.push({ email: "sam@glostaffing.com (summary)", status: "sent" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      results.push({ email: "sam@glostaffing.com (summary)", status: "failed", error: message });
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error("Send credentials error:", err);
    return NextResponse.json({ error: "Failed to send emails" }, { status: 500 });
  }
}
