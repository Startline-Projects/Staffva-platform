import { NextResponse } from "next/server";
import { sendEmail as sendEmailViaResend } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { generateInsights } from "@/lib/generateInsights";
import { assertRecruiterScope } from "@/lib/recruiterScope";
import { checkApprovalGates, checkApprovalPreconditions } from "@/lib/approvalGates";
import {
  computeReapplyEligibleAt,
  recordStatusEvent,
  REJECTABLE_FROM,
} from "@/lib/reviewOutcome";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function verifyAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.app_metadata?.role === "admin" ? user : null;
}

async function verifyAdminOrRecruiter() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  if (role !== "admin" && role !== "recruiter" && role !== "recruiting_manager") return null;
  return user;
}

/** The rejection reason is free text typed by a reviewer and interpolated into
 *  an HTML email. Escape it rather than trusting the person writing it not to
 *  paste a bracket. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Local wrapper. It shadowed the lib import and called through WITHOUT a
 * recipientKind, so all three outcome emails in this file — approved, rejected,
 * revision_required — went out past the candidate-email freeze that every other
 * candidate-facing path now respects. A wrapper that silently drops the one
 * argument the gate reads is worse than no wrapper.
 *
 * emailType is required here rather than defaulted, so a fourth outcome added
 * later cannot inherit somebody else's label.
 */
async function sendEmail(
  to: string,
  subject: string,
  html: string,
  emailType: string
): Promise<{ sent: boolean; reason?: string }> {
  if (!process.env.RESEND_API_KEY) {
    console.log("Resend not configured — skipping email to", to);
    return { sent: false, reason: "not_configured" };
  }

  try {
    const result = await sendEmailViaResend(
      {
        from: "StaffVA <noreply@staffva.com>",
        to,
        subject,
        html,
      },
      { recipientKind: "candidate", emailType }
    );
    // The freeze returns {suppressed:true} rather than throwing. Reporting that
    // as a send is how a reviewer ends up believing somebody was told.
    if (result && typeof result === "object" && "suppressed" in result) {
      return { sent: false, reason: "frozen" };
    }
    return { sent: true };
  } catch (err) {
    console.error("Failed to send email:", err);
    return { sent: false, reason: "error" };
  }
}

// POST — approve, reject, revision_required, or flag a candidate
export async function POST(request: Request) {
  const body = await request.json();
  const { candidateId, action, revisionNote, reason } = body;
  // Who is doing this. A decision with no name attached is not reviewable.
  let actingUserId: string | null = null;

  // revision_required is open to recruiters and admins; all other actions are admin-only
  if (action === "revision_required") {
    const caller = await verifyAdminOrRecruiter();
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    if (caller.app_metadata?.role === "recruiter") {
      const scopeError = await assertRecruiterScope(caller.id, candidateId);
      if (scopeError) {
        return NextResponse.json({ error: scopeError.error }, { status: scopeError.status });
      }
    }
  } else {
    const admin = await verifyAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    actingUserId = admin.id;
  }

  if (!candidateId || !action) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Candidate info for emails, plus every field the approval gates read
  const { data: candidate } = await supabase
    .from("candidates")
    .select(
      "id, email, full_name, english_mc_score, english_comprehension_score, voice_recording_1_url, voice_recording_2_url, id_verification_status, profile_photo_url, resume_url, tagline, bio, payout_method, interview_consent_at, admin_status, appeal_submitted_at, appeal_decision"
    )
    .eq("id", candidateId)
    .single();

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  if (action === "approve") {
    // Same checks as recruiter/approve and recruiting-manager/approve. This
    // was the last route that could set admin_status='approved' with no checks
    // at all — being admin-only is not a reason to skip them: an admin
    // override should be explicit and recorded, not the silent default of the
    // highest-privilege route. Two candidates went live through here without
    // a passed AI interview.
    const precondition = await checkApprovalPreconditions(supabase, candidate);
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

    // Compare-and-swap like the other approve routes: two clicks (or Approve
    // All racing a single approve) produce one approval and one 409, not two
    // approval emails. Also stamps profile_went_live_at, which this route
    // alone omitted.
    const { data: updated, error: updateError } = await supabase
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
      console.error("[Candidate Review] AI insights error:", err)
    );

    await sendEmail(
      candidate.email,
      "Your StaffVA profile is now live!",
      `<div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #1c1b1a;">Congratulations, ${candidate.full_name}!</h2>
        <p style="color: #555;">Your profile has been approved and is now live on StaffVA. Clients can now find you, view your profile, and reach out about opportunities.</p>
        <a href="https://staffva.com/candidate/me" style="display: inline-block; background: #fe6e3e; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">View Your Profile</a>
        <p style="color: #999; margin-top: 24px; font-size: 12px;">— The StaffVA Team</p>
      </div>`,
      "profile_approved");

    // Trigger 7: Profile approved email
    try {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";
      fetch(`${siteUrl}/api/candidate-emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Internal server-to-server call — authenticate to the gated route.
          authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`,
        },
        body: JSON.stringify({
          candidateId,
          emailType: "profile_approved",
          data: { profileUrl: `https://staffva.com/candidate/${candidateId}` },
        }),
      }).catch(() => {});
    } catch { /* non-fatal */ }

    return NextResponse.json({ success: true, action: "approved" });
  }

  // Undoing a decision. Today a rejection is reversible by nothing: every
  // review control is gated on active || pending_review, and
  // promote_candidate_if_ready refuses any status outside
  // ('active','pending_2nd_interview'). A decision this consequential that
  // cannot be taken back is a decision nobody should be making quickly.
  if (action === "reinstate") {
    const { data: restored, error: restoreError } = await supabase
      .from("candidates")
      .update({
        admin_status: "under_review",
        rejection_reason: null,
        rejected_at: null,
        rejected_by: null,
        reapply_eligible_at: null,
        // The appeal is cleared with the rejection, which is what makes "one
        // appeal per cycle" true: a reinstated candidate who is declined again
        // gets a fresh one.
        appeal_text: null,
        appeal_submitted_at: null,
        appeal_decision: null,
        appeal_decided_at: null,
        appeal_decided_by: null,
        appeal_response: null,
        review_entered_at: new Date().toISOString(),
      })
      .eq("id", candidateId)
      .eq("admin_status", "rejected")
      .select("id")
      .maybeSingle();

    if (restoreError) {
      console.error("[review] reinstate failed:", restoreError.message);
      return NextResponse.json({ error: "Could not reinstate." }, { status: 500 });
    }
    if (!restored) {
      return NextResponse.json(
        { error: "This candidate is not currently declined." },
        { status: 409 }
      );
    }

    await recordStatusEvent({
      candidateId,
      from: "rejected",
      to: "under_review",
      actorId: actingUserId,
      actorRole: "admin",
      reason: typeof reason === "string" && reason.trim() ? reason.trim() : "reinstated",
    });

    return NextResponse.json({ success: true, action: "reinstated" });
  }

  // Answering an appeal. Upholding keeps the decision and records the answer;
  // overturning reinstates. Both require words — the DB enforces it too.
  if (action === "appeal_uphold" || action === "appeal_overturn") {
    const response = typeof reason === "string" ? reason.trim() : "";
    if (response.length < 20) {
      return NextResponse.json(
        { error: "Write at least 20 characters. The candidate reads this." },
        { status: 400 }
      );
    }
    if (!candidate.appeal_submitted_at) {
      return NextResponse.json({ error: "There is no appeal to answer." }, { status: 409 });
    }
    if (candidate.appeal_decision) {
      return NextResponse.json({ error: "This appeal is already answered." }, { status: 409 });
    }

    const upheld = action === "appeal_uphold";
    const patch: Record<string, unknown> = {
      appeal_decision: upheld ? "upheld" : "overturned",
      appeal_decided_at: new Date().toISOString(),
      appeal_decided_by: actingUserId,
      appeal_response: response,
    };
    if (!upheld) {
      patch.admin_status = "under_review";
      patch.rejection_reason = null;
      patch.rejected_at = null;
      patch.rejected_by = null;
      patch.reapply_eligible_at = null;
      patch.review_entered_at = new Date().toISOString();
    }

    const { data: answered, error: appealError } = await supabase
      .from("candidates")
      .update(patch)
      .eq("id", candidateId)
      .is("appeal_decision", null)
      .select("id")
      .maybeSingle();

    if (appealError) {
      console.error("[review] appeal decision failed:", appealError.message);
      return NextResponse.json({ error: "Could not record the decision." }, { status: 500 });
    }
    if (!answered) {
      return NextResponse.json({ error: "This appeal is already answered." }, { status: 409 });
    }

    await recordStatusEvent({
      candidateId,
      from: "rejected",
      to: upheld ? "rejected" : "under_review",
      actorId: actingUserId,
      actorRole: "admin",
      reason: `appeal ${upheld ? "upheld" : "overturned"}: ${response}`,
    });

    return NextResponse.json({ success: true, action: upheld ? "upheld" : "overturned" });
  }

  if (action === "reject") {
    // A reason is required, and the database enforces it too
    // (candidates_rejection_is_recorded). Checking here as well gives the
    // reviewer a usable message instead of a raw constraint error.
    const rejectionReason = typeof reason === "string" ? reason.trim() : "";
    if (rejectionReason.length < 20) {
      return NextResponse.json(
        {
          error:
            "Give the candidate a reason of at least 20 characters. They see this, word for word.",
        },
        { status: 400 }
      );
    }
    if (rejectionReason.length > 4000) {
      return NextResponse.json({ error: "Reason is too long." }, { status: 400 });
    }

    const reapplyEligibleAt = computeReapplyEligibleAt();

    // Compare-and-swap, like the approve branch. The previous version fired an
    // UPDATE and discarded the result, so a double click rejected twice and a
    // stale tab could reject somebody who had since been approved — three of
    // the 31 approved candidates are in live engagements.
    const { data: rejected, error: rejectError } = await supabase
      .from("candidates")
      .update({
        admin_status: "rejected",
        rejection_reason: rejectionReason,
        rejected_at: new Date().toISOString(),
        rejected_by: actingUserId,
        reapply_eligible_at: reapplyEligibleAt,
      })
      .eq("id", candidateId)
      .in("admin_status", REJECTABLE_FROM as unknown as string[])
      .select("id, admin_status")
      .maybeSingle();

    if (rejectError) {
      console.error("[review] reject failed:", rejectError.message);
      return NextResponse.json({ error: "Could not record the decision." }, { status: 500 });
    }
    if (!rejected) {
      return NextResponse.json(
        {
          error:
            "This candidate is no longer in a state that can be declined — reload and check their current status.",
        },
        { status: 409 }
      );
    }

    await recordStatusEvent({
      candidateId,
      from: candidate.admin_status ?? null,
      to: "rejected",
      actorId: actingUserId,
      actorRole: "admin",
      reason: rejectionReason,
    });

    // The dashboard is the record. The email is a notice, and under the freeze
    // it may not go — so the response says which happened rather than
    // reporting a flat success the reviewer would read as "they were told".
    const mail = await sendEmail(
      candidate.email,
      "An update on your StaffVA application",
      `<div style="font-family: sans-serif; max-width: 520px; margin: 0 auto;">
        <h2 style="color: #1c1b1a;">Hi ${candidate.full_name},</h2>
        <p style="color: #555;">We have finished reviewing your application, and we are not able to take it forward at this time.</p>
        <p style="color: #555; white-space: pre-wrap;">${escapeHtml(rejectionReason)}</p>
        <p style="color: #555;">You can apply again from <strong>${new Date(reapplyEligibleAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</strong>. Your assessments and interviews stay on file — you will not repeat them.</p>
        <p style="color: #555;">If you think this was the wrong call, you can ask us to look again from your dashboard.</p>
        <p style="color: #999; margin-top: 24px; font-size: 12px;">— StaffVA</p>
      </div>`,
      "application_rejected"
    );

    return NextResponse.json({
      success: true,
      action: "rejected",
      reapplyEligibleAt,
      emailed: mail?.sent === true,
    });
  }

  if (action === "revision_required") {
    if (!revisionNote || revisionNote.trim().length === 0) {
      return NextResponse.json(
        { error: "Revision note is required" },
        { status: 400 }
      );
    }

    await supabase
      .from("candidates")
      .update({
        admin_status: "revision_required",
        admin_revision_note: revisionNote.trim(),
        admin_revision_sent_at: new Date().toISOString(),
      })
      .eq("id", candidateId);

    await sendEmail(
      candidate.email,
      "Your StaffVA profile needs a few updates",
      `<div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #1c1b1a;">Hi ${candidate.full_name},</h2>
        <p style="color: #555;">Thanks for completing your StaffVA profile. Our team reviewed your application and has some feedback before we can make your profile live.</p>
        <div style="background: #FFF7ED; border: 1px solid #FDBA74; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="color: #9A3412; font-weight: 600; margin: 0 0 8px 0; font-size: 14px;">Feedback from our team:</p>
          <p style="color: #7C2D12; margin: 0; white-space: pre-wrap;">${revisionNote.trim()}</p>
        </div>
        <p style="color: #555;">Please update your profile based on this feedback. Once you make the changes, resubmit from your dashboard and our team will review promptly.</p>
        <a href="https://staffva.com/apply" style="display: inline-block; background: #fe6e3e; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">Edit Your Profile</a>
        <p style="color: #999; margin-top: 24px; font-size: 12px;">— The StaffVA Team</p>
      </div>`,
      "revision_requested");

    return NextResponse.json({ success: true, action: "revision_required" });
  }

  if (action === "flag") {
    return NextResponse.json({ success: true, action: "flagged" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
