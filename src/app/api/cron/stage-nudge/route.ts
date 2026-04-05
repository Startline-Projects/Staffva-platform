import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdminClient();
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  let nudged = 0;

  // Stage 1 stalled — completed Stage 1 more than 48h ago, haven't started Stage 2
  const { data: stage1Stalled } = await admin
    .from("candidates")
    .select("id, email, full_name")
    .eq("application_stage", 1)
    .lt("stage1_completed_at", cutoff);

  for (const c of stage1Stalled || []) {
    // Check if we already sent this nudge
    const { data: existing } = await admin
      .from("candidate_emails")
      .select("id")
      .eq("candidate_id", c.id)
      .eq("email_type", "stage1_nudge")
      .eq("status", "sent")
      .maybeSingle();

    if (existing || !c.email) continue;

    const firstName = (c.full_name || "").split(" ")[0] || "there";

    if (process.env.RESEND_API_KEY) {
      try {
        await resend.emails.send({
          from: "StaffVA <notifications@staffva.com>",
          to: c.email,
          subject: "One step away from giveaway eligibility — complete your profile",
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">You're almost there, ${firstName}</h2>
            <p style="color:#444;font-size:14px;">You started your StaffVA application but haven't completed your professional profile yet. It only takes 3 minutes.</p>
            <p style="color:#444;font-size:14px;">Completing your profile makes you eligible for our $3,000 monthly giveaway and visible to U.S. clients.</p>
            <a href="https://staffva.com/apply" style="display:inline-block;background:#FE6E3E;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Complete My Profile</a>
            <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
          </div>`,
        });

        await admin.from("candidate_emails").insert({
          candidate_id: c.id,
          email_type: "stage1_nudge",
          status: "sent",
        });
        nudged++;
      } catch { /* silent */ }
    }
  }

  // Stage 2 stalled — completed Stage 2 more than 48h ago, haven't completed Stage 3
  const { data: stage2Stalled } = await admin
    .from("candidates")
    .select("id, email, full_name")
    .eq("application_stage", 2)
    .lt("stage2_completed_at", cutoff);

  for (const c of stage2Stalled || []) {
    const { data: existing } = await admin
      .from("candidate_emails")
      .select("id")
      .eq("candidate_id", c.id)
      .eq("email_type", "stage2_nudge")
      .eq("status", "sent")
      .maybeSingle();

    if (existing || !c.email) continue;

    const firstName = (c.full_name || "").split(" ")[0] || "there";

    if (process.env.RESEND_API_KEY) {
      try {
        await resend.emails.send({
          from: "StaffVA <notifications@staffva.com>",
          to: c.email,
          subject: "One last step — set your rate and go live",
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">Almost done, ${firstName}</h2>
            <p style="color:#444;font-size:14px;">Your professional profile looks great. You just need to set your hourly rate and availability — it takes under a minute.</p>
            <p style="color:#444;font-size:14px;">Once complete, you'll move to identity verification and be one step closer to going live.</p>
            <a href="https://staffva.com/apply" style="display:inline-block;background:#FE6E3E;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Set My Rate</a>
            <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
          </div>`,
        });

        await admin.from("candidate_emails").insert({
          candidate_id: c.id,
          email_type: "stage2_nudge",
          status: "sent",
        });
        nudged++;
      } catch { /* silent */ }
    }
  }

  return NextResponse.json({
    message: `Nudged ${nudged} stalled applications`,
    stage1: stage1Stalled?.length || 0,
    stage2: stage2Stalled?.length || 0,
    nudged,
  });
}
