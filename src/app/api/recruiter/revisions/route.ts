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

async function getRecruiterUser(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ).auth.getUser(token);
  if (!user) return null;
  const supabase = getAdminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !["recruiter", "recruiting_manager", "admin"].includes(profile.role)) return null;
  return { user, role: profile.role as string };
}

// POST — create a revision request
export async function POST(req: NextRequest) {
  const auth = await getRecruiterUser(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { user, role } = auth;

  const { candidateId, items } = await req.json();

  if (!candidateId || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "candidateId and items[] required" }, { status: 400 });
  }

  // Recruiters may only request revisions for candidates in their categories.
  if (role === "recruiter") {
    const scopeError = await assertRecruiterScope(user.id, candidateId);
    if (scopeError) {
      return NextResponse.json({ error: scopeError.error }, { status: scopeError.status });
    }
  }

  // Validate items shape
  for (const item of items) {
    if (!item.type || typeof item.type !== "string") {
      return NextResponse.json({ error: "Each item must have a type string" }, { status: 400 });
    }
  }

  const supabase = getAdminClient();

  // Insert profile_revisions record
  const { data: revision, error } = await supabase
    .from("profile_revisions")
    .insert({
      candidate_id: candidateId,
      requested_by: user.id,
      items,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update candidate admin_status to revision_required
  const hasVideoItem = items.some((item: { type: string }) =>
    item.type.toLowerCase().includes("video introduction")
  );

  const updateFields: Record<string, unknown> = {
    admin_status: "revision_required",
  };
  if (hasVideoItem) {
    updateFields.video_intro_revision_requested = true;
    // Give the takes back. Both takes are normally spent by the time anyone
    // reviews, so without this "please re-record your video" is an instruction
    // the candidate has no takes left to follow — and the recorder would
    // refuse them at the chunk route with "No takes remaining".
    updateFields.video_intro_takes_used = 0;
  }

  await supabase
    .from("candidates")
    .update(updateFields)
    .eq("id", candidateId);

  // Send consolidated email to candidate
  const { data: candidate } = await supabase
    .from("candidates")
    .select("email, display_name, full_name")
    .eq("id", candidateId)
    .single();

  if (candidate?.email && process.env.RESEND_API_KEY) {
    const itemsList = items
      .map((item: { type: string; note?: string }) =>
        `<li style="margin-bottom:8px;"><strong>${item.type}</strong>${item.note ? `<br/><span style="color:#666;font-size:13px;">${item.note}</span>` : ""}</li>`
      )
      .join("");

    try {
      await sendEmail({
          from: "StaffVA <notifications@staffva.com>",
          to: candidate.email,
          subject: `Action needed on your StaffVA profile — ${items.length} item${items.length > 1 ? "s" : ""} to complete`,
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">Profile Updates Needed</h2>
            <p style="color:#444;font-size:14px;">Hi ${candidate.display_name?.split(" ")[0] || candidate.full_name?.split(" ")[0] || "there"},</p>
            <p style="color:#444;font-size:14px;line-height:1.6;">Our team has reviewed your profile and identified ${items.length} item${items.length > 1 ? "s" : ""} that need${items.length === 1 ? "s" : ""} your attention before we can proceed.</p>
            <ul style="color:#444;font-size:14px;line-height:1.8;padding-left:20px;">${itemsList}</ul>
            <a href="https://staffva.com/candidate/dashboard" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Update Your Profile</a>
            <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
          </div>`,
        }, { recipientKind: "candidate", emailType: "profile_revisions_requested" });
    } catch { /* non-fatal */ }
  }

  // Create recruiter notification for tracking
  try {
    await supabase.from("recruiter_notifications").insert({
      recruiter_id: user.id,
      message: `Revision requested for ${candidate?.display_name || "candidate"} — ${items.length} item(s)`,
      candidate_id: candidateId,
    });
  } catch { /* non-fatal */ }

  return NextResponse.json({ success: true, revisionId: revision.id });
}
