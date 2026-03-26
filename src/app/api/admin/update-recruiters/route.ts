import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST() {
  const supabase = getAdminClient();
  const results: { action: string; status: string; detail?: string }[] = [];

  // ── 1. Update Abigail's email ──
  try {
    // Find Abigail's user ID
    const { data: abigailProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", "ops@glostaffing.com")
      .eq("full_name", "Abigail")
      .single();

    if (abigailProfile) {
      // Update auth.users email
      const { error: authErr } = await supabase.auth.admin.updateUserById(
        abigailProfile.id,
        { email: "abbybacon2327@gmail.com" }
      );

      if (authErr) {
        results.push({ action: "Update Abigail auth email", status: "error", detail: authErr.message });
      } else {
        results.push({ action: "Update Abigail auth email", status: "success" });
      }

      // Update profiles table
      await supabase
        .from("profiles")
        .update({ email: "abbybacon2327@gmail.com" })
        .eq("id", abigailProfile.id);
      results.push({ action: "Update Abigail profile email", status: "success" });

      // Send notification to Abigail
      try {
        await resend.emails.send({
          from: "StaffVA <notifications@staffva.com>",
          to: "abbybacon2327@gmail.com",
          subject: "Your StaffVA login email has been updated",
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
              <h2 style="color: #1C1B1A;">StaffVA</h2>
              <p style="color: #1C1B1A; font-size: 16px;">Hi Abigail,</p>
              <p style="color: #444; font-size: 14px; line-height: 1.6;">
                Your StaffVA recruiter account login email has been changed to <strong>abbybacon2327@gmail.com</strong>.
              </p>
              <p style="color: #444; font-size: 14px; line-height: 1.6;">
                Use this email going forward to log into <a href="https://staffva.com/login" style="color: #FE6E3E;">staffva.com</a>.
                Your password remains the same.
              </p>
            </div>
          `,
        });
        results.push({ action: "Email Abigail notification", status: "sent" });
      } catch (e) {
        results.push({ action: "Email Abigail notification", status: "error", detail: String(e) });
      }
    } else {
      results.push({ action: "Find Abigail", status: "not_found", detail: "No profile found with email ops@glostaffing.com and name Abigail" });
    }
  } catch (e) {
    results.push({ action: "Update Abigail", status: "error", detail: String(e) });
  }

  // ── 2. Create Leyan's account ──
  try {
    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email: "ops@glostaffing.com",
      password: "StaffVA@Leyan2026",
      email_confirm: true,
      user_metadata: {
        role: "recruiter",
        full_name: "Leyan",
      },
    });

    if (createErr) {
      results.push({ action: "Create Leyan auth account", status: "error", detail: createErr.message });
    } else if (newUser?.user) {
      results.push({ action: "Create Leyan auth account", status: "success" });

      // Ensure profile exists
      await supabase
        .from("profiles")
        .upsert({
          id: newUser.user.id,
          email: "ops@glostaffing.com",
          role: "recruiter",
          full_name: "Leyan",
        }, { onConflict: "id" });
      results.push({ action: "Create Leyan profile", status: "success" });

      // Add recruiter assignments — Support and Admin
      const supportAdminCategories = [
        "Customer Support Representative",
        "Administrative Assistant",
        "Virtual Assistant",
      ];

      for (const cat of supportAdminCategories) {
        await supabase
          .from("recruiter_assignments")
          .upsert({
            recruiter_id: newUser.user.id,
            role_category: cat,
          }, { onConflict: "recruiter_id,role_category" });
      }
      results.push({ action: "Assign Leyan categories", status: "success" });

      // Send credential email to Leyan
      try {
        await resend.emails.send({
          from: "StaffVA <notifications@staffva.com>",
          to: "ops@glostaffing.com",
          subject: "Your StaffVA recruiter access is ready",
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
              <h2 style="color: #1C1B1A;">StaffVA</h2>
              <p style="color: #1C1B1A; font-size: 16px;">Hi Leyan,</p>
              <p style="color: #444; font-size: 14px; line-height: 1.6;">
                Your StaffVA recruiter account has been created.
              </p>
              <div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="margin: 0 0 8px 0; font-size: 13px; color: #666;"><strong>Login URL:</strong> <a href="https://staffva.com/login" style="color: #FE6E3E;">staffva.com/login</a></p>
                <p style="margin: 0 0 8px 0; font-size: 13px; color: #666;"><strong>Email:</strong> ops@glostaffing.com</p>
                <p style="margin: 0; font-size: 13px; color: #666;"><strong>Temporary password:</strong> <code style="background: #fff; padding: 2px 6px; border-radius: 3px; border: 1px solid #e0e0e0;">StaffVA@Leyan2026</code></p>
              </div>
              <p style="color: #444; font-size: 14px; line-height: 1.6;">
                Log in and change your password immediately from the Account menu.
              </p>
            </div>
          `,
        });
        results.push({ action: "Email Leyan credentials", status: "sent" });
      } catch (e) {
        results.push({ action: "Email Leyan credentials", status: "error", detail: String(e) });
      }
    }
  } catch (e) {
    results.push({ action: "Create Leyan", status: "error", detail: String(e) });
  }

  // ── 3. Summary email to Sam ──
  try {
    await resend.emails.send({
      from: "StaffVA <notifications@staffva.com>",
      to: "sam@glostaffing.com",
      subject: "Recruiter account updates — Abigail + Leyan",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1C1B1A;">Recruiter Account Updates</h2>

          <h3 style="color: #1C1B1A; margin-top: 24px;">1. Abigail — Email Updated</h3>
          <div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 12px 0;">
            <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>Old email:</strong> ops@glostaffing.com</p>
            <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>New email:</strong> abbybacon2327@gmail.com</p>
            <p style="margin: 0; font-size: 14px;"><strong>Password:</strong> unchanged</p>
          </div>

          <h3 style="color: #1C1B1A; margin-top: 24px;">2. Leyan — New Account Created</h3>
          <div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 12px 0;">
            <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>Email:</strong> ops@glostaffing.com</p>
            <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>Password:</strong> StaffVA@Leyan2026</p>
            <p style="margin: 0; font-size: 14px;"><strong>Assigned:</strong> Support and Admin</p>
          </div>
        </div>
      `,
    });
    results.push({ action: "Summary email to Sam", status: "sent" });
  } catch (e) {
    results.push({ action: "Summary email to Sam", status: "error", detail: String(e) });
  }

  return NextResponse.json({ results });
}
