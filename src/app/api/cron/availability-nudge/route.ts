import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET — Vercel Cron calls this daily at 10am UTC
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getAdminClient();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    let nudgesSent = 0;
    let flagsSet = 0;

    // Step 1: Find candidates who haven't updated availability in 30+ days
    // and haven't been nudged yet (or nudged more than 30 days ago)
    const { data: needsNudge } = await supabase
      .from("candidates")
      .select("id, email, display_name, availability_last_updated_at, availability_nudge_sent_at")
      .eq("admin_status", "approved")
      .eq("needs_availability_update", false)
      .lt("availability_last_updated_at", thirtyDaysAgo)
      .or(`availability_nudge_sent_at.is.null,availability_nudge_sent_at.lt.${thirtyDaysAgo}`);

    // Send nudge emails
    if (needsNudge && needsNudge.length > 0 && process.env.RESEND_API_KEY) {
      for (const candidate of needsNudge) {
        try {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            },
            body: JSON.stringify({
              from: "StaffVA <notifications@staffva.com>",
              to: candidate.email,
              subject: "Are you still available on StaffVA?",
              html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
                  <h2 style="color: #1C1B1A; font-size: 18px;">Hi ${candidate.display_name?.split(" ")[0] || "there"},</h2>

                  <p style="color: #666; font-size: 14px; line-height: 1.6;">
                    Clients are actively browsing professionals in your category. We noticed you haven&rsquo;t updated your availability in a while.
                  </p>

                  <p style="color: #666; font-size: 14px; line-height: 1.6;">
                    Update your availability to make sure you show up in search results and are visible to potential clients.
                  </p>

                  <div style="text-align: center; margin: 28px 0;">
                    <a href="https://staffva.com/candidate/dashboard" style="display: inline-block; background: #FE6E3E; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Update my availability</a>
                  </div>

                  <p style="color: #999; font-size: 12px; border-top: 1px solid #E0E0E0; padding-top: 16px; margin-top: 32px;">
                    You received this because you have an active profile on StaffVA. If you&rsquo;re no longer looking for work, you can set your status to &ldquo;Not Available&rdquo; in your dashboard.
                  </p>
                </div>
              `,
            }),
          });

          // Mark as nudged
          await supabase
            .from("candidates")
            .update({ availability_nudge_sent_at: now.toISOString() })
            .eq("id", candidate.id);

          nudgesSent++;
        } catch {
          // Continue with next candidate
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Step 2: Flag candidates who were nudged 7+ days ago and still haven't updated
    const { data: needsFlag } = await supabase
      .from("candidates")
      .select("id")
      .eq("admin_status", "approved")
      .eq("needs_availability_update", false)
      .not("availability_nudge_sent_at", "is", null)
      .lt("availability_nudge_sent_at", sevenDaysAgo)
      .lt("availability_last_updated_at", thirtyDaysAgo);

    if (needsFlag && needsFlag.length > 0) {
      const ids = needsFlag.map((c) => c.id);
      await supabase
        .from("candidates")
        .update({ needs_availability_update: true })
        .in("id", ids);
      flagsSet = ids.length;
    }

    return NextResponse.json({
      message: `Nudges sent: ${nudgesSent}, Flags set: ${flagsSet}`,
      nudgesSent,
      flagsSet,
    });
  } catch (err) {
    console.error("Availability nudge cron error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
