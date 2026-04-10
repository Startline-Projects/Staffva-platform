import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function getAuthorizedProfile(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user } } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ).auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await admin()
    .from("profiles")
    .select("id, full_name, role, email")
    .eq("id", user.id)
    .single();
  if (!profile || !["admin", "recruiting_manager"].includes(profile.role)) return null;
  return profile as { id: string; full_name: string; role: string; email: string };
}

export async function POST(req: NextRequest) {
  const profile = await getAuthorizedProfile(req);
  if (!profile) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { candidateId, newRecruiterId, reason } = await req.json();
  if (!candidateId || !newRecruiterId) {
    return NextResponse.json({ error: "Missing candidateId or newRecruiterId" }, { status: 400 });
  }

  const supabase = admin();

  // Fetch candidate
  const { data: candidate } = await supabase
    .from("candidates")
    .select("id, display_name, full_name, email, role_category, assigned_recruiter, second_interview_status")
    .eq("id", candidateId)
    .single();
  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  const fromRecruiterId: string | null = candidate.assigned_recruiter || null;

  // Fetch new recruiter
  const { data: newRecruiter } = await supabase
    .from("profiles")
    .select("id, full_name, email, calendar_link")
    .eq("id", newRecruiterId)
    .single();
  if (!newRecruiter) return NextResponse.json({ error: "Recruiter not found" }, { status: 404 });

  // Fetch old recruiter
  let fromRecruiter: { id: string; full_name: string; email: string } | null = null;
  if (fromRecruiterId && fromRecruiterId !== newRecruiterId) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", fromRecruiterId)
      .single();
    fromRecruiter = data;
  }

  // 1. Update candidate assignment
  const { error: updateErr } = await supabase
    .from("candidates")
    .update({ assigned_recruiter: newRecruiterId })
    .eq("id", candidateId);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // 2. Log the reassignment
  await supabase.from("recruiter_reassignment_log").insert({
    candidate_id: candidateId,
    reassigned_by: profile.id,
    from_recruiter_id: fromRecruiterId,
    to_recruiter_id: newRecruiterId,
    reason: reason?.trim() || null,
  });

  // 3. High-priority in-platform notification for the old recruiter
  const candidateName = candidate.display_name || candidate.full_name || "A candidate";
  if (fromRecruiterId && fromRecruiter) {
    await supabase.from("recruiter_notifications").insert({
      recruiter_id: fromRecruiterId,
      candidate_id: candidateId,
      message: `${candidateName} has been reassigned to ${newRecruiter.full_name}. Cancel any scheduled appointments with this candidate immediately.`,
      priority: "high",
    });
  }

  // 4. Send emails (fire-and-forget; errors are silent)
  const RESEND = process.env.RESEND_API_KEY;
  const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";

  async function sendEmail(to: string, subject: string, html: string) {
    if (!RESEND) return;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "StaffVA <notifications@staffva.com>", to, subject, html }),
    }).catch(() => {});
  }

  const wrap = (body: string) =>
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">${body}<p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p></div>`;

  // 4a. Email candidate
  if (candidate.email) {
    const firstName = candidateName.split(" ")[0];
    const newFirst = (newRecruiter.full_name || "").split(" ")[0];
    const hasScheduled =
      candidate.second_interview_status &&
      candidate.second_interview_status !== "none" &&
      candidate.second_interview_status !== "not_scheduled";
    const appointmentLine = hasScheduled
      ? `If you had a previously scheduled appointment with your previous specialist, that appointment has been cancelled — please disregard any prior calendar invites and any booking confirmation emails you received from them. ${newFirst} will send you a fresh booking link to schedule your second interview.`
      : `Your new talent specialist will be in touch shortly with a booking link for your second interview.`;
    await sendEmail(
      candidate.email,
      "Your StaffVA talent specialist has been updated.",
      wrap(`<p style="color:#444;font-size:14px;">${firstName}, your talent specialist on StaffVA has been updated. <strong>${newRecruiter.full_name}</strong> is now your assigned specialist and will be in touch shortly to schedule or confirm your second interview.</p><p style="color:#444;font-size:14px;">${appointmentLine}</p>`)
    );
  }

  // 4b. Email old recruiter
  if (fromRecruiter?.email) {
    const fromFirst = (fromRecruiter.full_name || "").split(" ")[0];
    await sendEmail(
      fromRecruiter.email,
      "Candidate reassigned — action required.",
      wrap(`<p style="color:#444;font-size:14px;">${fromFirst}, <strong>${candidateName}</strong> (${candidate.role_category}) has been reassigned to <strong>${newRecruiter.full_name}</strong>. Please cancel any scheduled calendar appointments you have with this candidate immediately. They have already been notified that their previous appointment is cancelled. No further action is needed on their application — it is now being managed by ${newRecruiter.full_name}.</p>`)
    );
  }

  // 4c. Email new recruiter
  if (newRecruiter.email) {
    const toFirst = (newRecruiter.full_name || "").split(" ")[0];
    await sendEmail(
      newRecruiter.email,
      "New candidate assigned to you.",
      wrap(`<p style="color:#444;font-size:14px;">${toFirst}, <strong>${candidateName}</strong> (${candidate.role_category}) has been assigned to you. Review their profile and send them your calendar booking link to schedule their second interview.</p><a href="${SITE}/candidate/${candidateId}" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">View Candidate Profile</a>`)
    );
  }

  return NextResponse.json({ success: true });
}
