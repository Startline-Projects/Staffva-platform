import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import crypto from "crypto";

const resend = new Resend(process.env.RESEND_API_KEY);

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function verifyAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.user_metadata?.role === "admin" ? user : null;
}

// GET — list all recruiters with stats
export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = getAdminClient();

  const { data: recruiters } = await supabase
    .from("profiles")
    .select("id, email, full_name, created_at")
    .eq("role", "recruiter")
    .order("full_name");

  if (!recruiters || recruiters.length === 0) {
    return NextResponse.json({ recruiters: [] });
  }

  const { data: allAssignments } = await supabase
    .from("recruiter_assignments")
    .select("recruiter_id, role_category");

  const { data: allCandidates } = await supabase
    .from("candidates")
    .select("id, role_category, screening_tag, admin_status, display_name, full_name, country, hourly_rate, created_at, profile_photo_url");

  const recruiterIds = recruiters.map((r) => r.id);
  const { data: authData } = await supabase.auth.admin.listUsers();
  const lastLoginMap: Record<string, string> = {};
  if (authData?.users) {
    for (const u of authData.users) {
      if (recruiterIds.includes(u.id) && u.last_sign_in_at) {
        lastLoginMap[u.id] = u.last_sign_in_at;
      }
    }
  }

  const result = recruiters.map((r) => {
    const assignments = (allAssignments || [])
      .filter((a) => a.recruiter_id === r.id)
      .map((a) => a.role_category);

    const candidates = (allCandidates || []).filter((c) =>
      assignments.includes(c.role_category)
    );

    const priorityCount = candidates.filter((c) => c.screening_tag === "Priority").length;
    const reviewCount = candidates.filter((c) => c.screening_tag === "Review").length;
    const holdCount = candidates.filter((c) => c.screening_tag === "Hold").length;

    const statusCounts: Record<string, number> = {};
    for (const c of candidates) {
      statusCounts[c.admin_status] = (statusCounts[c.admin_status] || 0) + 1;
    }

    return {
      id: r.id,
      email: r.email,
      full_name: r.full_name,
      created_at: r.created_at,
      last_login: lastLoginMap[r.id] || null,
      assignments,
      total_candidates: candidates.length,
      priority_count: priorityCount,
      review_count: reviewCount,
      hold_count: holdCount,
      status_counts: statusCounts,
      candidates: candidates.map((c) => ({
        id: c.id,
        display_name: c.display_name || c.full_name,
        country: c.country,
        role_category: c.role_category,
        hourly_rate: c.hourly_rate,
        screening_tag: c.screening_tag,
        admin_status: c.admin_status,
        profile_photo_url: c.profile_photo_url,
        created_at: c.created_at,
      })),
    };
  });

  return NextResponse.json({ recruiters: result });
}

// POST — reset recruiter password
export async function POST(req: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { recruiter_id } = await req.json();
  if (!recruiter_id) {
    return NextResponse.json({ error: "Missing recruiter_id" }, { status: 400 });
  }

  const supabase = getAdminClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name, role")
    .eq("id", recruiter_id)
    .single();

  if (!profile || profile.role !== "recruiter") {
    return NextResponse.json({ error: "Recruiter not found" }, { status: 404 });
  }

  const newPassword = "StaffVA@" + crypto.randomBytes(4).toString("hex").toUpperCase() + "!";

  const { error: updateError } = await supabase.auth.admin.updateUserById(
    recruiter_id,
    { password: newPassword }
  );

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  try {
    await resend.emails.send({
      from: "StaffVA <notifications@staffva.com>",
      to: profile.email,
      subject: "Your StaffVA password has been reset",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1C1B1A;">StaffVA</h2>
          <p style="color: #1C1B1A; font-size: 16px;">Hi ${profile.full_name},</p>
          <p style="color: #444; font-size: 14px; line-height: 1.6;">
            Your StaffVA password has been reset by the administrator.
          </p>
          <div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0 0 8px 0; font-size: 13px; color: #666;"><strong>Your new temporary password:</strong></p>
            <p style="margin: 0; font-size: 16px; color: #1C1B1A; font-family: monospace; background: #fff; padding: 8px 12px; border-radius: 4px; border: 1px solid #e0e0e0;">${newPassword}</p>
          </div>
          <p style="color: #444; font-size: 14px; line-height: 1.6;">
            Login at <a href="https://staffva.com/login" style="color: #FE6E3E;">staffva.com/login</a> and change your password immediately from the Account menu.
          </p>
        </div>
      `,
    });
  } catch { /* silent */ }

  try {
    await resend.emails.send({
      from: "StaffVA <notifications@staffva.com>",
      to: "sam@glostaffing.com",
      subject: `Password reset — ${profile.full_name} (${profile.email})`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1C1B1A;">Password Reset Confirmation</h2>
          <p style="color: #444; font-size: 14px;">The following account password was reset:</p>
          <div style="background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>Name:</strong> ${profile.full_name}</p>
            <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>Email:</strong> ${profile.email}</p>
            <p style="margin: 0; font-size: 14px;"><strong>New password:</strong> <code>${newPassword}</code></p>
          </div>
        </div>
      `,
    });
  } catch { /* silent */ }

  return NextResponse.json({ success: true, email: profile.email });
}
