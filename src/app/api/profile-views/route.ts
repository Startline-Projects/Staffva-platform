import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST — Record a profile view + trigger notification email on first view
export async function POST(req: NextRequest) {
  try {
    const supabase = getAdminClient();

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ).auth.getUser(token);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { candidate_id } = await req.json();
    if (!candidate_id) {
      return NextResponse.json({ error: "Missing candidate_id" }, { status: 400 });
    }

    // Check if user is a client
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!client) {
      return NextResponse.json({ success: true, recorded: false });
    }

    // Check if this is a first-time view (no existing record for this pair)
    const { data: existingView } = await supabase
      .from("profile_views")
      .select("id")
      .eq("client_id", client.id)
      .eq("candidate_id", candidate_id)
      .maybeSingle();

    const isFirstView = !existingView;

    // Upsert — update viewed_at if same client+candidate pair already exists
    await supabase.from("profile_views").upsert(
      {
        candidate_id,
        client_id: client.id,
        viewed_at: new Date().toISOString(),
      },
      { onConflict: "client_id,candidate_id" }
    );

    // On first view — send notification email (max 1 per 24 hours)
    if (isFirstView) {
      try {
        await sendProfileViewNotification(supabase, candidate_id);
      } catch { /* silent — don't block view recording */ }
    }

    return NextResponse.json({ success: true, recorded: true, firstView: isFirstView });
  } catch (err) {
    console.error("Profile view error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Send profile view notification email (capped at 1/day)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendProfileViewNotification(
  supabase: any,
  candidateId: string
) {
  // Check 24-hour cap — don't send if already sent today
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentEmail } = await supabase
    .from("candidate_emails")
    .select("id")
    .eq("candidate_id", candidateId)
    .eq("email_type", "profile_view_notification")
    .eq("status", "sent")
    .gte("sent_at", oneDayAgo)
    .limit(1)
    .maybeSingle();

  if (recentEmail) return; // Already sent in last 24 hours

  // Get candidate info
  const { data: candidate } = await supabase
    .from("candidates")
    .select("email, display_name, full_name, id")
    .eq("id", candidateId)
    .single();

  if (!candidate?.email) return;

  const firstName = (candidate.display_name || candidate.full_name || "").split(" ")[0] || "there";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";

  // Send email
  if (process.env.RESEND_API_KEY) {
    try {
      await resend.emails.send({
        from: "StaffVA <notifications@staffva.com>",
        to: candidate.email,
        subject: "A client just viewed your profile",
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
          <h2 style="color:#1C1B1A;">Your profile is getting noticed</h2>
          <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
          <p style="color:#444;font-size:14px;">A verified client just viewed your profile on StaffVA. This means your skills and experience are catching the attention of U.S. businesses looking to hire.</p>
          <div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:8px;padding:16px;margin:16px 0;">
            <p style="margin:0;color:#9A3412;font-size:13px;font-weight:600;">Make the best impression</p>
            <p style="margin:8px 0 0;color:#9A3412;font-size:13px;">Make sure your profile is complete and your availability status is current. A polished profile with a strong bio, updated skills, and a professional photo gets more responses.</p>
          </div>
          <a href="${siteUrl}/apply" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px;">Review My Profile</a>
          <p style="color:#999;margin-top:24px;font-size:12px;">Keep up the great work. — The StaffVA Team</p>
        </div>`,
      });

      // Log in candidate_emails
      await supabase.from("candidate_emails").insert({
        candidate_id: candidateId,
        email_type: "profile_view_notification",
        status: "sent",
      });
    } catch {
      await supabase.from("candidate_emails").insert({
        candidate_id: candidateId,
        email_type: "profile_view_notification",
        status: "failed",
      });
    }
  }
}

// GET — Get view stats for a candidate (including daily breakdown)
export async function GET(req: NextRequest) {
  try {
    const supabase = getAdminClient();

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ).auth.getUser(token);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: candidate } = await supabase
      .from("candidates")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    const now = new Date();

    // Views this week (last 7 days)
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: weekViews } = await supabase
      .from("profile_views")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", candidate.id)
      .gte("viewed_at", weekAgo);

    // Views this month (last 30 days)
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count: monthViews } = await supabase
      .from("profile_views")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", candidate.id)
      .gte("viewed_at", monthAgo);

    // Total views all time
    const { count: totalViews } = await supabase
      .from("profile_views")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", candidate.id);

    // Daily breakdown for past 7 days
    const { data: recentViews } = await supabase
      .from("profile_views")
      .select("viewed_at")
      .eq("candidate_id", candidate.id)
      .gte("viewed_at", weekAgo);

    const dailyCounts: { day: string; label: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayKey = d.toISOString().split("T")[0];
      const label = d.toLocaleDateString("en-US", { weekday: "short" });
      const count = (recentViews || []).filter((v) => {
        const vDate = new Date(v.viewed_at).toISOString().split("T")[0];
        return vDate === dayKey;
      }).length;
      dailyCounts.push({ day: dayKey, label, count });
    }

    // New views since last dashboard visit (views today for notification count)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const { count: todayViews } = await supabase
      .from("profile_views")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", candidate.id)
      .gte("viewed_at", todayStart);

    return NextResponse.json({
      weekViews: weekViews || 0,
      monthViews: monthViews || 0,
      totalViews: totalViews || 0,
      dailyCounts,
      todayViews: todayViews || 0,
    });
  } catch (err) {
    console.error("Profile views stats error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
