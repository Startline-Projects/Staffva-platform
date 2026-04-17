import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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
    // Auth: Bearer token pattern
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
    } = await createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ).auth.getUser(token);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getAdminClient();

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, full_name")
      .eq("id", user.id)
      .single();

    if (
      !profile ||
      (profile.role !== "recruiter" && profile.role !== "recruiting_manager")
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { candidateId } = await req.json();
    if (!candidateId) {
      return NextResponse.json(
        { error: "Missing candidateId" },
        { status: 400 }
      );
    }

    // Fetch candidate with all fields needed for gate check + pre-conditions
    const { data: candidate } = await supabase
      .from("candidates")
      .select(
        "id, email, full_name, display_name, assigned_recruiter, role_category, second_interview_status, english_mc_score, english_comprehension_score, voice_recording_1_url, voice_recording_2_url, id_verification_status, profile_photo_url, resume_url, tagline, bio, payout_method, interview_consent_at, admin_status"
      )
      .eq("id", candidateId)
      .single();

    if (!candidate) {
      return NextResponse.json(
        { error: "Candidate not found" },
        { status: 404 }
      );
    }

    // Pre-condition 1: Second interview must be completed
    if (candidate.second_interview_status !== "completed") {
      return NextResponse.json(
        { error: "Second interview not completed" },
        { status: 400 }
      );
    }

    // Pre-condition 2: AI interview must be passed
    const { data: aiInterview } = await supabase
      .from("ai_interviews")
      .select("id")
      .eq("candidate_id", candidateId)
      .eq("status", "completed")
      .eq("passed", true)
      .limit(1)
      .maybeSingle();

    if (!aiInterview) {
      return NextResponse.json(
        { error: "AI interview not passed" },
        { status: 400 }
      );
    }

    // Run 10-gate approval check
    const { pass, failingConditions } = checkApprovalGates(candidate);

    if (!pass) {
      return NextResponse.json(
        {
          error: "Candidate does not meet all approval requirements",
          failingConditions,
        },
        { status: 400 }
      );
    }

    // Approve candidate — race condition guard with admin_status check
    const { data: updated, error: updateError } = await supabase
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
      console.error("[Recruiter Approve] AI insights error:", err)
    );

    // Send approval email via Resend
    if (process.env.RESEND_API_KEY && candidate.email) {
      const firstName =
        (candidate.display_name || candidate.full_name || "")
          .split(" ")[0] || "there";
      const siteUrl =
        process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";

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
            subject:
              "You passed your second interview — your profile is live.",
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Congratulations — You're Live!</h2>
              <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
              <p style="color:#444;font-size:14px;">Congratulations on passing your second interview! Your profile is now live on StaffVA and visible to clients looking for talent like you.</p>
              <a href="${siteUrl}/candidate/${candidateId}" style="display:inline-block;background:#FE6E3E;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">View My Live Profile</a>
              <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
            </div>`,
          }),
        });
      } catch {
        /* silent */
      }
    }

    // Notify all recruiting managers
    const recruiterName = profile.full_name || "A recruiter";
    const candidateName =
      candidate.display_name || candidate.full_name || "A candidate";

    const { data: managers } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "recruiting_manager");

    if (managers && managers.length > 0) {
      const notifications = managers.map((m: { id: string }) => ({
        manager_id: m.id,
        candidate_id: candidateId,
        recruiter_id: user.id,
        message: `${candidateName} — ${candidate.role_category} just went live via ${recruiterName}.`,
      }));

      await supabase.from("manager_notifications").insert(notifications);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Recruiter Approve] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
