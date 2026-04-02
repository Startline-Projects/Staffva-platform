import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Daily SLA alert — fires at 8am UTC
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Resend not configured" }, { status: 500 });
  }

  const supabase = getAdminClient();
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // Find all red SLA candidates (waiting 48+ hours)
  const { data: redCandidates } = await supabase
    .from("candidates")
    .select("id, display_name, full_name, email, country, role_category, assigned_recruiter, waiting_since, screening_tag")
    .not("waiting_since", "is", null)
    .lt("waiting_since", fortyEightHoursAgo)
    .in("admin_status", ["pending_speaking_review"])
    .order("waiting_since", { ascending: true });

  if (!redCandidates || redCandidates.length === 0) {
    return NextResponse.json({ message: "No red SLA candidates", count: 0 });
  }

  // Group by recruiter
  const byRecruiter: Record<string, typeof redCandidates> = {};
  for (const c of redCandidates) {
    const r = c.assigned_recruiter || "Unassigned";
    if (!byRecruiter[r]) byRecruiter[r] = [];
    byRecruiter[r].push(c);
  }

  // Get recruiter emails
  const { data: recruiters } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("role", "recruiter");

  const recruiterEmails: Record<string, string> = {};
  for (const r of recruiters || []) {
    recruiterEmails[r.full_name] = r.email;
  }

  let emailsSent = 0;

  // Send per-recruiter alerts
  for (const [recruiterName, cands] of Object.entries(byRecruiter)) {
    const recruiterEmail = recruiterEmails[recruiterName];
    const recipients = [recruiterEmail, "sam@glostaffing.com"].filter(Boolean);

    if (recipients.length === 0) continue;

    const rows = cands.map((c) => {
      const hours = Math.round((Date.now() - new Date(c.waiting_since!).getTime()) / (1000 * 60 * 60));
      return `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${c.display_name || c.full_name}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${c.country}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${c.role_category}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${c.screening_tag || "—"}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;color:red;font-weight:600;">${hours}h</td>
      </tr>`;
    }).join("");

    try {
      await resend.emails.send({
        from: "StaffVA <notifications@staffva.com>",
        to: recipients,
        subject: `🔴 ${cands.length} candidate(s) waiting 48+ hours — ${recruiterName}`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:700px;margin:0 auto;padding:24px;">
          <h2 style="color:#1C1B1A;">SLA Alert — Candidates Waiting 48+ Hours</h2>
          <p style="color:#444;font-size:14px;">Hi ${recruiterName}, the following ${cands.length} candidate(s) in your queue have been waiting over 48 hours for their second interview.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #e0e0e0;">
            <thead>
              <tr style="background:#f9f9f9;">
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Name</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Country</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Role</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Tag</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Wait</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <a href="https://staffva.com/recruiter" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Open Recruiter Dashboard</a>
        </div>`,
      });
      emailsSent++;
    } catch { /* silent */ }
  }

  return NextResponse.json({
    message: `SLA alerts sent for ${redCandidates.length} red candidates across ${Object.keys(byRecruiter).length} recruiters`,
    redCount: redCandidates.length,
    emailsSent,
  });
}
