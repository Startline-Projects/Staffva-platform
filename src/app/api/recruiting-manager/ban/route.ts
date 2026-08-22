import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

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

    const { candidateId, reason } = await req.json();

    if (!candidateId) {
      return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });
    }

    if (!reason || typeof reason !== "string" || reason.trim().length < 20) {
      return NextResponse.json(
        { error: "Reason must be at least 20 characters." },
        { status: 400 }
      );
    }

    const admin = getAdminClient();

    // Fetch candidate
    const { data: candidate } = await admin
      .from("candidates")
      .select("id, full_name, display_name, role_category, email")
      .eq("id", candidateId)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    // Fetch Manar's profile ID
    const { data: manarsProfile } = await admin
      .from("profiles")
      .select("id, full_name")
      .eq("id", user.id)
      .single();

    // Set ban pending — do NOT change admin_status
    await admin
      .from("candidates")
      .update({
        ban_pending_review: true,
        ban_requested_by: user.id,
        ban_requested_at: new Date().toISOString(),
        ban_reason: reason.trim(),
      })
      .eq("id", candidateId);

    const candidateName = candidate.display_name || candidate.full_name;
    const requesterName = manarsProfile?.full_name || "Recruiting Manager";
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";
    const confirmationLink = `${siteUrl}/admin/pending-bans`;

    // Send internal notification email to Ahmed
    if (process.env.RESEND_API_KEY) {
      try {
        await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: "sam@glostaffing.com",
            subject: `Ban Request — ${candidateName} (${candidate.role_category})`,
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Ban Request Pending Your Review</h2>
              <p style="color:#444;font-size:14px;">${requesterName} has flagged a candidate for deactivation. No action has been taken yet — this requires your confirmation.</p>
              <div style="background:#fef9f0;border:1px solid #fed7aa;border-radius:8px;padding:16px;margin:16px 0;">
                <p style="margin:0 0 6px;font-size:14px;color:#1C1B1A;"><strong>Candidate:</strong> ${candidateName}</p>
                <p style="margin:0 0 6px;font-size:14px;color:#1C1B1A;"><strong>Role:</strong> ${candidate.role_category}</p>
                <p style="margin:0 0 6px;font-size:14px;color:#1C1B1A;"><strong>Requested by:</strong> ${requesterName}</p>
                <p style="margin:0;font-size:14px;color:#1C1B1A;"><strong>Reason:</strong> ${reason.trim()}</p>
              </div>
              <a href="${confirmationLink}" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px;">Review in Admin Panel</a>
              <p style="color:#999;margin-top:24px;font-size:12px;">The candidate remains active until you confirm or dismiss this request.</p>
            </div>`,
          });
      } catch { /* silent */ }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[RM Ban] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
