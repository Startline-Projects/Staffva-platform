import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { generateInsights } from "@/lib/generateInsights";
import { checkApprovalGates, checkApprovalPreconditions } from "@/lib/approvalGates";

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

    if (!user || user.app_metadata?.role !== "recruiting_manager") {
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
      .select("id, email, full_name, display_name, english_mc_score, english_comprehension_score, voice_recording_1_url, voice_recording_2_url, id_verification_status, profile_photo_url, resume_url, tagline, bio, payout_method, interview_consent_at, admin_status")
      .eq("id", candidateId)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    // Interview preconditions. These were missing here entirely — this route
    // selected second_interview_status and never read it, and never looked at
    // the AI interview at all. At the time of the fix that meant 41 candidates
    // could be pushed live through this endpoint that recruiter/approve would
    // have refused, 23 of whom had never passed the AI interview.
    //
    // A recruiting manager outranks a recruiter, so it is tempting to read the
    // missing checks as an intentional override. They are not: there is no flag,
    // no recorded reason and no audit trail — the checks are simply absent. If a
    // deliberate override is wanted it should be explicit and recorded, not the
    // default behaviour of the higher-privilege route.
    const precondition = await checkApprovalPreconditions(admin, candidate);
    if (!precondition.ok) {
      return NextResponse.json(
        { error: precondition.error },
        { status: precondition.status }
      );
    }

    // 10-gate approval check (shared)
    const { pass, failingConditions } = checkApprovalGates(candidate);

    if (!pass) {
      return NextResponse.json(
        { error: "Candidate does not meet all approval requirements", failingConditions },
        { status: 400 }
      );
    }

    // Approve candidate. The .neq guard makes this a compare-and-swap: two
    // managers clicking at once produce one approval and one 409, rather than
    // two "successes", two approval emails and two profile_went_live_at writes.
    // The result was also being discarded here, so a failed update reported
    // success and the candidate was emailed to say they were live.
    const { data: updated, error: updateError } = await admin
      .from("candidates")
      .update({
        admin_status: "approved",
        profile_went_live_at: new Date().toISOString(),
      })
      .eq("id", candidateId)
      .neq("admin_status", "approved")
      .select("id")
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        { error: "Candidate already approved or update failed" },
        { status: 409 }
      );
    }

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
        await sendEmail({
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
          });
      } catch { /* silent */ }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[RM Approve] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
