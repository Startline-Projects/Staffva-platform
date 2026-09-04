import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { assertRecruiterScope } from "@/lib/recruiterScope";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * GET /api/admin/video-review
 * Returns all candidates with pending video introductions
 */
export async function GET() {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || (user.app_metadata?.role !== "admin" && user.app_metadata?.role !== "recruiter" && user.app_metadata?.role !== "recruiting_manager")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const admin = getAdminClient();

    const { data } = await admin
      .from("candidates")
      .select("id, display_name, country, role_category, video_intro_url, video_intro_status, video_intro_submitted_at")
      .eq("video_intro_status", "pending_review")
      .order("video_intro_submitted_at", { ascending: true });

    return NextResponse.json({ candidates: data || [] });
  } catch (error) {
    console.error("Video review list error:", error);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}

/**
 * POST /api/admin/video-review
 * Body: { candidateId, action: "approve" | "revision_required" | "reject", adminNote? }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || (user.app_metadata?.role !== "admin" && user.app_metadata?.role !== "recruiter" && user.app_metadata?.role !== "recruiting_manager")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { candidateId, action, adminNote } = await req.json();
    if (!candidateId || !action) {
      return NextResponse.json({ error: "Missing candidateId or action" }, { status: 400 });
    }

    // Recruiters may only act on candidates in their assigned categories.
    if (user.app_metadata?.role === "recruiter") {
      const scopeError = await assertRecruiterScope(user.id, candidateId);
      if (scopeError) {
        return NextResponse.json({ error: scopeError.error }, { status: scopeError.status });
      }
    }

    const admin = getAdminClient();

    // Get candidate
    const { data: candidate } = await admin
      .from("candidates")
      .select("id, email, display_name, full_name")
      .eq("id", candidateId)
      .single();

    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    const now = new Date().toISOString();
    const firstName = (candidate.display_name || candidate.full_name || "").split(" ")[0] || "there";

    if (action === "approve") {
      await admin.from("candidates").update({
        video_intro_status: "approved",
        video_intro_reviewed_at: now,
        video_intro_admin_note: null,
      }).eq("id", candidateId);

      await admin.from("video_intro_reviews").insert({
        candidate_id: candidateId,
        admin_user_id: user.id,
        decision: "approved",
        admin_note: adminNote || null,
      });

      // Email candidate
      if (process.env.RESEND_API_KEY && candidate.email) {
        try {
          await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: candidate.email,
            subject: "Your video introduction is live",
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Your Video Is Live!</h2>
              <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
              <p style="color:#444;font-size:14px;">Your video introduction has been approved and is now visible to clients on your StaffVA profile.</p>
              <a href="https://staffva.com/candidate/dashboard" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px;">View Dashboard</a>
              <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
            </div>`,
          }, { recipientKind: "candidate", emailType: "video_intro_reviewed" });
        } catch { /* silent */ }
      }

      return NextResponse.json({ success: true, action: "approved" });
    }

    if (action === "revision_required") {
      if (!adminNote) return NextResponse.json({ error: "Admin note required for revision" }, { status: 400 });

      await admin.from("candidates").update({
        video_intro_status: "revision_required",
        video_intro_admin_note: adminNote,
      }).eq("id", candidateId);

      await admin.from("video_intro_reviews").insert({
        candidate_id: candidateId,
        admin_user_id: user.id,
        decision: "revision_required",
        admin_note: adminNote,
      });

      if (process.env.RESEND_API_KEY && candidate.email) {
        try {
          await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: candidate.email,
            subject: "Your video introduction needs a small update",
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Almost There!</h2>
              <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
              <p style="color:#444;font-size:14px;">Thank you for submitting your video introduction. Our team reviewed it and has one suggestion before we can approve it:</p>
              <div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:8px;padding:16px;margin:16px 0;">
                <p style="margin:0;color:#9A3412;font-size:13px;font-style:italic;">"${adminNote}"</p>
              </div>
              <p style="color:#444;font-size:14px;">Please re-record and resubmit at any time. Your profile remains live while you work on this.</p>
              <a href="https://staffva.com/profile/video-intro" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px;">Re-record Video</a>
              <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
            </div>`,
          }, { recipientKind: "candidate", emailType: "video_intro_reviewed" });
        } catch { /* silent */ }
      }

      return NextResponse.json({ success: true, action: "revision_required" });
    }

    if (action === "reject") {
      if (!adminNote) return NextResponse.json({ error: "Rejection reason required" }, { status: 400 });

      await admin.from("candidates").update({
        video_intro_status: "rejected",
        video_intro_admin_note: adminNote,
      }).eq("id", candidateId);

      await admin.from("video_intro_reviews").insert({
        candidate_id: candidateId,
        admin_user_id: user.id,
        decision: "rejected",
        admin_note: adminNote,
      });

      if (process.env.RESEND_API_KEY && candidate.email) {
        try {
          await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: candidate.email,
            subject: "Your video introduction could not be approved",
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Video Review Update</h2>
              <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
              <p style="color:#444;font-size:14px;">We reviewed your video introduction and unfortunately could not approve it for the following reason:</p>
              <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0;">
                <p style="margin:0;color:#991b1b;font-size:13px;">${adminNote}</p>
              </div>
              <p style="color:#444;font-size:14px;">You are welcome to record a new video and resubmit. Your profile remains live.</p>
              <a href="https://staffva.com/profile/video-intro" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px;">Record New Video</a>
              <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
            </div>`,
          }, { recipientKind: "candidate", emailType: "video_intro_reviewed" });
        } catch { /* silent */ }
      }

      return NextResponse.json({ success: true, action: "rejected" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Video review action error:", error);
    return NextResponse.json({ error: "Failed to process review" }, { status: 500 });
  }
}
