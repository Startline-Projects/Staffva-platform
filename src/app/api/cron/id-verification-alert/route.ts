import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Runs daily — alerts admin about ID verifications stuck in manual_review for 72+ hours
export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getAdminClient();
  const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

  // Find candidates in manual_review for 72+ hours
  const { data: overdue } = await supabase
    .from("candidates")
    .select("id, display_name, full_name, email, id_verification_submitted_at")
    .eq("id_verification_status", "manual_review")
    .not("id_verification_submitted_at", "is", null)
    .lt("id_verification_submitted_at", seventyTwoHoursAgo);

  if (!overdue || overdue.length === 0) {
    return NextResponse.json({ message: "No overdue verifications", count: 0 });
  }

  // Send alert email to admin
  if (process.env.RESEND_API_KEY) {
    const candidateList = overdue
      .map((c) => {
        const hours = Math.floor(
          (Date.now() - new Date(c.id_verification_submitted_at!).getTime()) / (1000 * 60 * 60)
        );
        return `<li><strong>${c.display_name || c.full_name}</strong> (${c.email}) — ${hours} hours in review</li>`;
      })
      .join("");

    try {
      await sendEmail({
          from: "StaffVA <notifications@staffva.com>",
          to: "sam@glostaffing.com",
          subject: `Alert: ${overdue.length} ID verification(s) overdue — 72+ hours in manual review`,
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">ID Verification Overdue Alert</h2>
            <p style="color:#444;font-size:14px;">${overdue.length} candidate(s) have been in Stripe Identity manual review for more than 72 hours with no resolution:</p>
            <ul style="color:#444;font-size:14px;line-height:1.8;">${candidateList}</ul>
            <p style="color:#444;font-size:14px;">This may indicate a Stripe processing delay. Consider manually reviewing these candidates or contacting Stripe support.</p>
            <a href="https://staffva.com/admin/candidates" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Go to Admin Panel</a>
          </div>`,
        });
    } catch (err) {
      console.error("Failed to send overdue alert:", err);
    }
  }

  return NextResponse.json({
    message: `Alert sent for ${overdue.length} overdue verification(s)`,
    count: overdue.length,
  });
}
