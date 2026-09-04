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

async function verifyAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.app_metadata?.role === "admin" ? user : null;
}

// GET — list all candidates with ban_pending_review = true
export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const supabase = getAdminClient();

  const { data: candidates } = await supabase
    .from("candidates")
    .select("id, full_name, display_name, role_category, country, admin_status, ban_reason, ban_requested_at, ban_requested_by")
    .eq("ban_pending_review", true)
    .order("ban_requested_at", { ascending: true });

  // Fetch requester names
  const requesterIds = [...new Set((candidates || []).map((c) => c.ban_requested_by).filter(Boolean))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", requesterIds.length > 0 ? requesterIds : ["none"]);

  const profileMap = new Map((profiles || []).map((p) => [p.id, p.full_name]));

  const enriched = (candidates || []).map((c) => ({
    ...c,
    ban_requested_by_name: profileMap.get(c.ban_requested_by) || "Unknown",
  }));

  return NextResponse.json({ candidates: enriched });
}

// POST — confirm or dismiss a ban
export async function POST(req: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { candidateId, action } = await req.json();

  if (!candidateId || !action) {
    return NextResponse.json({ error: "Missing candidateId or action" }, { status: 400 });
  }

  if (action !== "confirm" && action !== "dismiss") {
    return NextResponse.json({ error: "action must be confirm or dismiss" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Fetch candidate + ban requester info
  const { data: candidate } = await supabase
    .from("candidates")
    .select("id, full_name, display_name, role_category, ban_pending_review, ban_requested_by, ban_reason")
    .eq("id", candidateId)
    .single();

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  if (!candidate.ban_pending_review) {
    return NextResponse.json({ error: "No pending ban for this candidate" }, { status: 400 });
  }

  const candidateName = candidate.display_name || candidate.full_name;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";

  if (action === "confirm") {
    // Deactivate candidate, clear ban flag
    await supabase
      .from("candidates")
      .update({
        admin_status: "deactivated",
        ban_pending_review: false,
      })
      .eq("id", candidateId);

    // Notify Manar via email
    if (process.env.RESEND_API_KEY && candidate.ban_requested_by) {
      const { data: manar } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", candidate.ban_requested_by)
        .single();

      if (manar?.email) {
        try {
          await sendEmail({
              from: "StaffVA <notifications@staffva.com>",
              to: manar.email,
              subject: `Ban confirmed — ${candidateName}`,
              html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                <h2 style="color:#1C1B1A;">Ban Confirmed</h2>
                <p style="color:#444;font-size:14px;">Hi ${manar.full_name || "there"},</p>
                <p style="color:#444;font-size:14px;">Ahmed has confirmed your ban request. <strong>${candidateName}</strong> (${candidate.role_category}) has been deactivated and removed from the browse page.</p>
                <a href="${siteUrl}/candidate/${candidateId}" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">View Candidate</a>
                <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
              </div>`,
            }, { recipientKind: "staff", emailType: "ban_confirmed" });
        } catch { /* silent */ }
      }
    }

    return NextResponse.json({ success: true, action: "confirmed" });
  }

  // action === "dismiss"
  await supabase
    .from("candidates")
    .update({ ban_pending_review: false })
    .eq("id", candidateId);

  // Notify Manar
  if (process.env.RESEND_API_KEY && candidate.ban_requested_by) {
    const { data: manar } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", candidate.ban_requested_by)
      .single();

    if (manar?.email) {
      try {
        await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: manar.email,
            subject: `Ban dismissed — ${candidateName}`,
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Ban Request Dismissed</h2>
              <p style="color:#444;font-size:14px;">Hi ${manar.full_name || "there"},</p>
              <p style="color:#444;font-size:14px;">Ahmed has reviewed your ban request for <strong>${candidateName}</strong> (${candidate.role_category}) and decided not to proceed. The candidate remains active.</p>
              <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
            </div>`,
          }, { recipientKind: "staff", emailType: "ban_dismissed" });
      } catch { /* silent */ }
    }
  }

  return NextResponse.json({ success: true, action: "dismissed" });
}
