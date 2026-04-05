import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

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
    if (!user || (user.user_metadata?.role !== "admin" && user.user_metadata?.role !== "recruiter")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json();
    const { candidateId, action } = body;
    if (!candidateId || !action) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    const admin = getAdminClient();

    const { data: candidate } = await admin
      .from("candidates")
      .select("id, email, display_name, full_name, first_name, last_name")
      .eq("id", candidateId)
      .single();

    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    const firstName = candidate.first_name || candidate.display_name?.split(" ")[0] || "there";
    const fullName = candidate.full_name || candidate.display_name || "Candidate";
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";

    // ═══ APPROVE AND PUSH LIVE ═══
    if (action === "approve") {
      await admin.from("candidates").update({
        admin_status: "approved",
        profile_went_live_at: new Date().toISOString(),
      }).eq("id", candidateId);

      if (process.env.RESEND_API_KEY && candidate.email) {
        try {
          await resend.emails.send({
            from: "StaffVA <notifications@staffva.com>",
            to: candidate.email,
            subject: "You're live. Clients can find you right now.",
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">You're Live on StaffVA!</h2>
              <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
              <p style="color:#444;font-size:14px;">Congratulations. Your profile has been reviewed and approved by our team. You are now live on StaffVA and visible to clients.</p>
              <a href="${siteUrl}/candidate/${candidate.id}" style="display:inline-block;background:#FE6E3E;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">View My Live Profile</a>
              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0;">
                <p style="margin:0;color:#166534;font-weight:600;">You're eligible for the $3,000 monthly giveaway</p>
                <p style="margin:8px 0 0;color:#166534;font-size:13px;">Winners are announced on the first of each month.</p>
              </div>
              <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
            </div>`,
          });
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
          await resend.emails.send({
            from: "StaffVA <notifications@staffva.com>",
            to: candidate.email,
            subject: "Your StaffVA profile needs a few updates before it goes live",
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Profile Updates Needed</h2>
              <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
              <p style="color:#444;font-size:14px;">Your recruiter has reviewed your profile and has requested the following updates before your profile can go live:</p>
              <div style="background:#f9f9f9;border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin:16px 0;">
                ${changeListHtml}
              </div>
              ${generalNote ? `<p style="color:#444;font-size:13px;font-style:italic;">"${generalNote}"</p>` : ""}
              <p style="color:#444;font-size:14px;">Once you have made these updates, please resubmit your profile for review from your dashboard.</p>
              <a href="${siteUrl}/apply" style="display:inline-block;background:#FE6E3E;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Update My Profile</a>
              <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
            </div>`,
          });
        } catch { /* silent */ }
      }

      return NextResponse.json({ success: true, action: "changes_requested" });
    }

    // ═══ CANDIDATE RESUBMIT ═══
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
          await resend.emails.send({
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
