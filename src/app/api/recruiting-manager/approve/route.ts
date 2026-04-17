import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { generateInsights } from "@/lib/generateInsights";
import { checkApprovalGates } from "@/lib/approvalGates";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || user.user_metadata?.role !== "recruiting_manager") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { candidateId } = await req.json();
    if (!candidateId) {
      return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });
    }

    const admin = getAdminClient();

    // Fetch candidate with all fields required for 10-gate check
    const { data: candidate } = await admin
      .from("candidates")
      .select("id, email, full_name, display_name, second_interview_status, english_mc_score, english_comprehension_score, voice_recording_1_url, voice_recording_2_url, id_verification_status, profile_photo_url, resume_url, tagline, bio, payout_method, interview_consent_at, admin_status")
      .eq("id", candidateId)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    // 10-gate approval check (shared)
    const { pass, failingConditions } = checkApprovalGates(candidate);

    if (!pass) {
      return NextResponse.json(
        { error: "Candidate does not meet all approval requirements", failingConditions },
        { status: 400 }
      );
    }

    // Approve candidate
    await admin
      .from("candidates")
      .update({
        admin_status: "approved",
        profile_went_live_at: new Date().toISOString(),
      })
      .eq("id", candidateId);

    // Fire AI insights (fire-and-forget)
    generateInsights(candidateId).catch((err) =>
      console.error("[RM Approve] AI insights error:", err)
    );

    // Send approval email via Resend
    if (process.env.RESEND_API_KEY && candidate.email) {
      const firstName =
        (candidate.display_name || candidate.full_name || "").split(" ")[0] || "there";
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";

      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "StaffVA <notifications@staffva.com>",
            to: candidate.email,
            subject: "You're live. Clients can find you right now.",
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">You're Live on StaffVA!</h2>
              <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
              <p style="color:#444;font-size:14px;">Congratulations. Your profile has been reviewed and approved by our team. You are now live on StaffVA and visible to clients.</p>
              <a href="${siteUrl}/candidate/${candidateId}" style="display:inline-block;background:#FE6E3E;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">View My Live Profile</a>
              <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
            </div>`,
          }),
        });
      } catch { /* silent */ }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[RM Approve] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
