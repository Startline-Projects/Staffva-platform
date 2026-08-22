import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { assertRecruiterScope } from "@/lib/recruiterScope";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ).auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getAdminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !["recruiter", "recruiting_manager", "admin"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { candidateId, revisionId } = await req.json();
  if (!candidateId) return NextResponse.json({ error: "candidateId required" }, { status: 400 });

  // Recruiters may only remind candidates in their assigned categories.
  if (profile.role === "recruiter") {
    const scopeError = await assertRecruiterScope(user.id, candidateId);
    if (scopeError) {
      return NextResponse.json({ error: scopeError.error }, { status: scopeError.status });
    }
  }

  // Check 48h cooldown — look for recent reminder notification
  const { data: recentReminder } = await supabase
    .from("recruiter_notifications")
    .select("created_at")
    .eq("candidate_id", candidateId)
    .like("message", "%Revision reminder sent%")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (recentReminder) {
    const hoursSince = (Date.now() - new Date(recentReminder.created_at).getTime()) / (1000 * 60 * 60);
    if (hoursSince < 48) {
      const hoursLeft = Math.ceil(48 - hoursSince);
      return NextResponse.json({ error: `Reminder cooldown: ${hoursLeft}h remaining` }, { status: 429 });
    }
  }

  // Get candidate + revision info
  const { data: candidate } = await supabase
    .from("candidates")
    .select("email, display_name, full_name")
    .eq("id", candidateId)
    .single();

  const { data: revision } = await supabase
    .from("profile_revisions")
    .select("items")
    .eq("id", revisionId)
    .eq("status", "pending")
    .single();

  if (!candidate || !revision) {
    return NextResponse.json({ error: "Candidate or revision not found" }, { status: 404 });
  }

  // Send reminder email
  if (process.env.RESEND_API_KEY) {
    const itemsList = (revision.items as { type: string }[])
      .map((item) => `<li>${item.type}</li>`)
      .join("");

    try {
      await sendEmail({
          from: "StaffVA <notifications@staffva.com>",
          to: candidate.email,
          subject: "Reminder: Your StaffVA profile needs updates",
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">Profile Update Reminder</h2>
            <p style="color:#444;font-size:14px;">Hi ${candidate.display_name?.split(" ")[0] || "there"},</p>
            <p style="color:#444;font-size:14px;">You still have pending items on your StaffVA profile:</p>
            <ul style="color:#444;font-size:14px;">${itemsList}</ul>
            <a href="https://staffva.com/candidate/dashboard" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Update Your Profile</a>
            <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
          </div>`,
        });
    } catch { /* non-fatal */ }
  }

  // Log reminder
  await supabase.from("recruiter_notifications").insert({
    recruiter_id: user.id,
    message: `Revision reminder sent to ${candidate.display_name || "candidate"}`,
    candidate_id: candidateId,
  });

  return NextResponse.json({ success: true });
}
