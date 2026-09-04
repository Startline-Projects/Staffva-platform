import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { assertRecruiterScope } from "@/lib/recruiterScope";
import { generateInsights } from "@/lib/generateInsights";
import { checkApprovalGates, checkApprovalPreconditions } from "@/lib/approvalGates";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * POST /api/admin/profile-review
 * Actions: approve, request_changes
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || (user.app_metadata?.role !== "admin" && user.app_metadata?.role !== "recruiter" && user.app_metadata?.role !== "recruiting_manager")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json();
    const { candidateId, action } = body;
    if (!candidateId || !action) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    // Recruiters may only act on candidates in their assigned categories.
    if (user.app_metadata?.role === "recruiter") {
      const scopeError = await assertRecruiterScope(user.id, candidateId);
      if (scopeError) {
        return NextResponse.json({ error: scopeError.error }, { status: scopeError.status });
      }
    }

    const admin = getAdminClient();

    // Identity fields for emails, plus every field the approval gates read
    const { data: candidate } = await admin
      .from("candidates")
      .select(
        "id, email, display_name, full_name, first_name, last_name, english_mc_score, english_comprehension_score, voice_recording_1_url, voice_recording_2_url, id_verification_status, profile_photo_url, resume_url, tagline, bio, payout_method, interview_consent_at, admin_status"
      )
      .eq("id", candidateId)
      .single();

    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    const firstName = candidate.first_name || candidate.display_name?.split(" ")[0] || "there";
    const fullName = candidate.full_name || candidate.display_name || "Candidate";
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";

    // ═══ APPROVE AND PUSH LIVE ═══
    if (action === "approve") {
      // Same checks as recruiter/approve and recruiting-manager/approve — this
      // route and candidates/review were the two left that pushed a profile
      // live without them, which is how two candidates with no passed AI
      // interview went live.
      const precondition = await checkApprovalPreconditions(admin, candidate);
      if (!precondition.ok) {
        return NextResponse.json(
          { error: precondition.error },
          { status: precondition.status }
        );
      }

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

      // Compare-and-swap like the other approve routes: a double approval
      // produces one success and one 409, not two "you're live" emails.
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

      // Fire AI insights generation (fire-and-forget)
      generateInsights(candidateId).catch((err) =>
        console.error("[Profile Review] AI insights error:", err)
      );

      if (process.env.RESEND_API_KEY && candidate.email) {
        try {
          await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: candidate.email,
            subject: "You're live. Clients can find you right now.",
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">You're Live on StaffVA!</h2>
              <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
              <p style="color:#444;font-size:14px;">Congratulations. Your profile has been reviewed and approved by our team. You are now live on StaffVA and visible to clients.</p>
              <a href="${siteUrl}/candidate/${candidate.id}" style="display:inline-block;background:#FE6E3E;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">View My Live Profile</a>
              <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
            </div>`,
          }, { recipientKind: "candidate", emailType: "profile_approved" });
        } catch { /* silent */ }
      }

      return NextResponse.json({ success: true, action: "approved" });
    }

    // ═══ REQUEST CHANGES ═══
    if (action === "request_changes") {
      const { changeItems, generalNote } = body;
      if (!changeItems || !Array.isArray(changeItems) || changeItems.length === 0) {
        return NextResponse.json({ error: "At least one change item required" }, { status: 400 });
      }

      // Insert change request
      await admin.from("candidate_change_requests").insert({
        candidate_id: candidateId,
        recruiter_id: user.id,
        change_items: changeItems,
        general_note: generalNote || null,
        status: "pending",
      });

      // Update admin status
      await admin.from("candidates").update({
        admin_status: "changes_requested",
      }).eq("id", candidateId);

      // Send email
      if (process.env.RESEND_API_KEY && candidate.email) {
        const changeListHtml = changeItems.map((item: { area: string; instruction: string }) =>
          `<div style="margin-bottom:12px;">
            <p style="margin:0;font-weight:600;color:#1C1B1A;font-size:14px;">${item.area}</p>
            <p style="margin:4px 0 0;color:#444;font-size:13px;">${item.instruction}</p>
          </div>`
        ).join("");

        try {
          await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: candidate.email,
            subject: "Your StaffVA profile needs a few updates before it goes live",
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Profile Updates Needed</h2>
              <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
              <p style="color:#444;font-size:14px;">Your Talent Specialist has reviewed your profile and has requested the following updates before your profile can go live:</p>
              <div style="background:#f9f9f9;border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin:16px 0;">
                ${changeListHtml}
              </div>
              ${generalNote ? `<p style="color:#444;font-size:13px;font-style:italic;">"${generalNote}"</p>` : ""}
              <p style="color:#444;font-size:14px;">Once you have made these updates, please resubmit your profile for review from your dashboard.</p>
              <a href="${siteUrl}/apply" style="display:inline-block;background:#FE6E3E;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Update My Profile</a>
              <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
            </div>`,
          }, { recipientKind: "candidate", emailType: "revision_requested" });
        } catch { /* silent */ }
      }

      return NextResponse.json({ success: true, action: "changes_requested" });
    }

    // ═══ CANDIDATE RESUBMIT ═══
    // TODO: wire this up in the edit-with-approval feature build (no caller as of Phase 2A audit)
    if (action === "resubmit") {
      // Set back to under_review
      await admin.from("candidates").update({
        admin_status: "under_review",
      }).eq("id", candidateId);

      // Resolve pending change requests
      await admin.from("candidate_change_requests").update({
        resolved_at: new Date().toISOString(),
        status: "resolved",
      }).eq("candidate_id", candidateId).eq("status", "pending");

      // Notify recruiter
      const { data: changeReq } = await admin.from("candidate_change_requests")
        .select("recruiter_id")
        .eq("candidate_id", candidateId)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (process.env.RESEND_API_KEY && changeReq?.recruiter_id) {
        try {
          await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: "sam@glostaffing.com",
            subject: `Candidate has resubmitted for review — ${fullName}`,
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Profile Resubmitted</h2>
              <p style="color:#444;font-size:14px;"><strong>${fullName}</strong> has updated their profile and resubmitted for your review.</p>
              <a href="${siteUrl}/admin/candidates" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Review in Admin</a>
            </div>`,
          });
        } catch { /* silent */ }
      }

      return NextResponse.json({ success: true, action: "resubmitted" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Profile review error:", error);
    return NextResponse.json({ error: "Failed to process" }, { status: 500 });
  }
}
