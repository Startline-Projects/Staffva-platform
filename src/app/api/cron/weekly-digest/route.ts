import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET — Vercel Cron calls this every Monday at 9am UTC
export async function GET(req: NextRequest) {
  try {
    // Verify cron secret to prevent unauthorized calls
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getAdminClient();
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Get platform-wide stats for the week
    const { count: newClientsThisWeek } = await supabase
      .from("clients")
      .select("*", { count: "exact", head: true })
      .gte("created_at", weekAgo);

    const { count: newHiresThisWeek } = await supabase
      .from("engagements")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .gte("created_at", weekAgo);

    // Get role-specific job post counts
    const { data: jobPostsThisWeek } = await supabase
      .from("job_posts")
      .select("role_category")
      .gte("created_at", weekAgo);

    const rolePostCounts: Record<string, number> = {};
    if (jobPostsThisWeek) {
      for (const jp of jobPostsThisWeek) {
        const role = jp.role_category || "Other";
        rolePostCounts[role] = (rolePostCounts[role] || 0) + 1;
      }
    }

    // Get all approved candidates
    const { data: candidates } = await supabase
      .from("candidates")
      .select("id, email, display_name, role_category")
      .eq("admin_status", "approved");

    if (!candidates || candidates.length === 0) {
      return NextResponse.json({ message: "No approved candidates to email", sent: 0 });
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ message: "Resend API key not configured", sent: 0 });
    }

    let sentCount = 0;
    const errors: string[] = [];

    for (const candidate of candidates) {
      const rolesPosted = rolePostCounts[candidate.role_category] || 0;

      try {
        await sendEmail({
            from: "StaffVA <digest@staffva.com>",
            to: candidate.email,
            subject: "This week on StaffVA",
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
                <div style="text-align: center; margin-bottom: 24px;">
                  <h1 style="color: #1C1B1A; font-size: 20px; margin: 0;">This week on StaffVA</h1>
                  <p style="color: #666; font-size: 14px; margin-top: 4px;">Your weekly platform update</p>
                </div>

                <div style="background: #FAFAFA; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                  <p style="color: #1C1B1A; font-size: 14px; margin: 0 0 4px;">Hi ${candidate.display_name?.split(" ")[0] || "there"},</p>
                  <p style="color: #666; font-size: 14px; margin: 0;">Here&rsquo;s what happened on StaffVA this past week:</p>
                </div>

                <div style="margin-bottom: 20px;">
                  <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                    <div style="background: white; border: 1px solid #E0E0E0; border-radius: 8px; padding: 16px; flex: 1; text-align: center;">
                      <p style="color: #FE6E3E; font-size: 24px; font-weight: 700; margin: 0;">${newClientsThisWeek || 0}</p>
                      <p style="color: #666; font-size: 12px; margin: 4px 0 0;">New clients joined</p>
                    </div>
                    <div style="background: white; border: 1px solid #E0E0E0; border-radius: 8px; padding: 16px; flex: 1; text-align: center;">
                      <p style="color: #FE6E3E; font-size: 24px; font-weight: 700; margin: 0;">${rolesPosted}</p>
                      <p style="color: #666; font-size: 12px; margin: 4px 0 0;">Roles posted in ${candidate.role_category}</p>
                    </div>
                    <div style="background: white; border: 1px solid #E0E0E0; border-radius: 8px; padding: 16px; flex: 1; text-align: center;">
                      <p style="color: #FE6E3E; font-size: 24px; font-weight: 700; margin: 0;">${newHiresThisWeek || 0}</p>
                      <p style="color: #666; font-size: 12px; margin: 4px 0 0;">Professionals hired</p>
                    </div>
                  </div>
                </div>

                ${rolesPosted > 0 ? `
                <div style="background: #FFF7ED; border: 1px solid #FDBA74; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                  <p style="color: #1C1B1A; font-size: 14px; font-weight: 600; margin: 0;">Clients are looking for ${candidate.role_category} professionals!</p>
                  <p style="color: #666; font-size: 13px; margin: 8px 0 0;">${rolesPosted} role${rolesPosted > 1 ? "s were" : " was"} posted in your category this week. Make sure your profile is complete and your availability is up to date.</p>
                </div>
                ` : ""}

                <div style="text-align: center; margin-top: 24px;">
                  <a href="https://staffva.com/apply" style="display: inline-block; background: #FE6E3E; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Update your profile</a>
                </div>

                <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #E0E0E0; text-align: center;">
                  <p style="color: #999; font-size: 11px; margin: 0;">You received this because you have an active profile on StaffVA.</p>
                  <p style="color: #999; font-size: 11px; margin: 4px 0 0;">StaffVA &middot; staffva.com</p>
                </div>
              </div>
            `,
          });
        sentCount++;
      } catch (err) {
        errors.push(`Failed to send to ${candidate.email}: ${err}`);
      }

      // Rate limit: small delay between emails
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return NextResponse.json({
      message: `Weekly digest sent to ${sentCount} candidates`,
      sent: sentCount,
      errors: errors.length > 0 ? errors : undefined,
      stats: {
        newClientsThisWeek: newClientsThisWeek || 0,
        newHiresThisWeek: newHiresThisWeek || 0,
        rolePostCounts,
      },
    });
  } catch (err) {
    console.error("Weekly digest cron error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
