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

// POST — Reassign a candidate from "Needs Routing" to a specific recruiter
export async function POST(req: NextRequest) {
  const supabase = getAdminClient();

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ).auth.getUser(token);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "recruiter" && profile.role !== "admin" && profile.role !== "recruiting_manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { candidateId, newRecruiterId } = await req.json();
  if (!candidateId || !newRecruiterId) {
    return NextResponse.json({ error: "Missing candidateId or newRecruiterId" }, { status: 400 });
  }

  // A plain recruiter may only reassign candidates inside their own categories;
  // admins and recruiting_managers route across the whole pipeline.
  if (profile.role === "recruiter") {
    const scopeError = await assertRecruiterScope(user.id, candidateId);
    if (scopeError) {
      return NextResponse.json({ error: scopeError.error }, { status: scopeError.status });
    }
  }

  // Get candidate info for the notification message
  const { data: candidate } = await supabase
    .from("candidates")
    .select("display_name, full_name, role_category, assignment_pending_review, assigned_recruiter")
    .eq("id", candidateId)
    .single();

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  // Get new recruiter name and calendar link
  const { data: newRecruiter } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", newRecruiterId)
    .single();

  if (!newRecruiter) {
    return NextResponse.json({ error: "Recruiter not found" }, { status: 404 });
  }

  // Update candidate: assign to new recruiter, clear pending flags.
  // Optimistic concurrency — the update only applies if assigned_recruiter is
  // still what we read a moment ago. Without this, two managers routing the
  // same "Needs Routing" candidate both succeed: last write wins on the row,
  // but BOTH recruiters get a "routed to you" notification and both think they
  // own the candidate. Using the previous value (rather than requiring
  // assignment_pending_review) keeps re-routing an already-assigned candidate
  // working too.
  let updateQuery = supabase
    .from("candidates")
    .update({
      assigned_recruiter: newRecruiterId,
      assigned_recruiter_at: new Date().toISOString(),
      assignment_pending_review: false,
      // NOT screening_tag: null.
      //
      // The screening verdict is a function of the CANDIDATE, not of who is
      // assigned to them. The model that produces it is given name, country,
      // role, experience, rate, bio, US experience, skills and tools — no
      // recruiter field anywhere — and this route changes only the assignment.
      // So reassigning cannot invalidate the verdict, and nulling the tag did
      // not mark it stale, it destroyed it: the score and the reason survive in
      // their own columns with nothing left to say what they concluded.
      //
      // Nothing re-enqueues after a reassignment either, so the tag never came
      // back. 32 candidates were left with a score, a reason and no tag —
      // invisible to every tag-filtered recruiter view and silently miscounted
      // in every tag-based dashboard total. The sibling route,
      // admin/reassign, has always left the tag alone; these two disagreed.
    })
    .eq("id", candidateId);

  updateQuery = candidate.assigned_recruiter
    ? updateQuery.eq("assigned_recruiter", candidate.assigned_recruiter)
    : updateQuery.is("assigned_recruiter", null);

  const { data: updatedRows, error: updateError } = await updateQuery.select("id");

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json(
      { error: "This candidate was routed by someone else just now — reload and try again." },
      { status: 409 }
    );
  }

  // Create platform notification for the newly assigned recruiter
  const candidateName = candidate.display_name || candidate.full_name || "A candidate";
  await supabase.from("recruiter_notifications").insert({
    recruiter_id: newRecruiterId,
    candidate_id: candidateId,
    message: `${candidateName} (${candidate.role_category}) has been routed to you by ${profile.full_name || "Manar"}.`,
  });

  // Resolve any unrouted alerts for this candidate
  await supabase
    .from("unrouted_alerts")
    .update({ resolved_at: new Date().toISOString() })
    .eq("candidate_id", candidateId)
    .is("resolved_at", null);

  // For "Other" role candidates: send email notification with recruiter info
  if (candidate.role_category === "Other") {
    const { data: candidateFull } = await supabase
      .from("candidates")
      .select("email, display_name, full_name")
      .eq("id", candidateId)
      .single();

    if (process.env.RESEND_API_KEY && candidateFull?.email) {
      const firstName =
        (candidateFull.display_name || candidateFull.full_name || "").split(" ")[0] || "there";
      const recruiterName = newRecruiter.full_name || "your recruiter";
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";

      try {
        await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: candidateFull.email,
            subject: "Your recruiter has been assigned",
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Your Recruiter Has Been Assigned</h2>
              <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
              <p style="color:#444;font-size:14px;">You have been assigned a talent specialist: <strong>${recruiterName}</strong>. They are your point of contact at StaffVA.</p>
              <a href="${siteUrl}/candidate/dashboard" style="display:inline-block;background:#FE6E3E;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Go to Dashboard</a>
              <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
            </div>`,
          });
      } catch { /* silent */ }
    }
  }

  return NextResponse.json({ success: true });
}
