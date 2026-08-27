import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { generateInsights } from "@/lib/generateInsights";

/**
 * POST /api/webhooks/ai-interview-complete
 * Trigger AI insights regeneration when an AI interview is completed.
 * Body: { candidateId: string }
 * Protected by CRON_SECRET bearer token.
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { candidateId } = await req.json();
    if (!candidateId) {
      return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check this candidate's latest completed AI interview (pass or fail)
    const { data: aiInterview } = await supabase
      .from("ai_interviews")
      .select("id, passed, status, overall_score")
      .eq("candidate_id", candidateId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Pass threshold: overall_score >= 60. This is the single source of truth
    // for pass/fail — we do not trust the upstream `passed` flag.
    const overallScore = aiInterview?.overall_score ?? 0;
    const passed = overallScore >= 60;

    // Writeback to candidates row — ai_interview_completed_at marks completion
    // regardless of pass/fail; on fail admin_status flips to
    // 'ai_interview_failed' so the dashboard can render the retake gate.
    //
    // A pass no longer sets a status here. It used to write
    // 'pending_2nd_interview', a step that no longer exists; whether a pass makes
    // someone approvable also depends on the ten profile gates, so
    // promote_candidate_if_ready decides that below.
    //
    // This route currently has no callers — the interview app scores and
    // promotes directly. It is kept in working order rather than left holding a
    // status that would strand anyone the day someone wires it up.
    const candidateUpdate: Record<string, unknown> = {
      ai_interview_completed_at: new Date().toISOString(),
      ...(passed ? {} : { admin_status: "ai_interview_failed" }),
    };
    // Reset retake-ready notification flag on every fail so the cron will
    // re-notify the candidate when the new 3-day window unlocks.
    if (!passed) {
      candidateUpdate.ai_interview_retake_notified_at = null;
    }
    await supabase.from("candidates").update(candidateUpdate).eq("id", candidateId);

    if (passed) {
      const { error: promoteError } = await supabase.rpc("promote_candidate_if_ready", {
        p_candidate_id: candidateId,
      });
      if (promoteError) {
        console.error(
          `[CRITICAL] Could not decide placement for ${candidateId}:`,
          promoteError.message
        );
      }
    }

    const { data: candidate } = await supabase
      .from("candidates")
      .select("role_category, email, display_name, full_name, assigned_recruiter")
      .eq("id", candidateId)
      .single();

    // On fail: insert interview_attempts row with a 3-day retake lockout and
    // send the fail email. No recruiter assignment, no "Other" role routing.
    if (!passed) {
      const { count: priorAttempts } = await supabase
        .from("interview_attempts")
        .select("*", { count: "exact", head: true })
        .eq("candidate_id", candidateId);

      const nextRetakeAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

      await supabase.from("interview_attempts").insert({
        candidate_id: candidateId,
        attempt_number: (priorAttempts ?? 0) + 1,
        ai_interview_id: aiInterview?.id ?? null,
        next_retake_available_at: nextRetakeAt,
      });

      if (process.env.RESEND_API_KEY && candidate?.email) {
        const firstName =
          (candidate.display_name || candidate.full_name || "").split(" ")[0] || "there";
        try {
          await sendEmail({
              from: "StaffVA <notifications@staffva.com>",
              to: candidate.email,
              subject: "Your AI interview results — retake available in 3 days",
              html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                <h2 style="color:#1C1B1A;">Your AI interview results</h2>
                <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
                <p style="color:#444;font-size:14px;">Your AI interview score was <strong>${overallScore}</strong> out of 100. A score of <strong>60 or above</strong> is required to proceed to the next step.</p>
                <p style="color:#444;font-size:14px;">Your retake will unlock in 3 days. We will send you another email the moment it becomes available — no action needed on your side until then.</p>
                <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
              </div>`,
            });
        } catch (err) {
          console.error("[AI Interview Webhook] Fail email send error:", err);
        }
      }

      // Fire and forget insights generation so the candidate can still see dimension scores.
      generateInsights(candidateId).catch((err) =>
        console.error("[AI Insights Webhook] Error:", err)
      );

      return NextResponse.json({ success: true, message: "Fail recorded, retake scheduled" });
    }

    // ─── Pass branch ───────────────────────────────────────────────────────
    // Preserve recruiter continuity on retake re-pass: candidates demoted by migration 00083 retain their original recruiter across the demote → retake → re-pass cycle. Auto-assignment only fires for candidates with no prior recruiter.
    if (candidate?.assigned_recruiter) {
      console.log("[AI Interview Webhook] Preserving existing recruiter assignment:", candidate.assigned_recruiter, "for candidate:", candidateId, "(retake re-pass — migration 00083 remediation)");
    } else if (candidate?.role_category) {
      // Auto-assign recruiter based on role_category
      const { data: assignment } = await supabase
        .from("recruiter_assignments")
        .select("recruiter_id")
        .eq("role_category", candidate.role_category)
        .limit(1)
        .maybeSingle();

      if (assignment?.recruiter_id) {
        // Guard: admin must never be auto-assigned via recruiter_assignments routing table.
        // Manual assignment to admin is done only through the reassignment modal.
        const { data: assigneeProfile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", assignment.recruiter_id)
          .single();

        if (assigneeProfile?.role === "admin") {
          console.warn("[AI Interview Webhook] Skipped auto-assignment: recruiter_id", assignment.recruiter_id, "is admin — remove from recruiter_assignments routing table.");
        } else {
          const isPendingReview = candidate.role_category === "Other";
          await supabase
            .from("candidates")
            .update({
              assigned_recruiter: assignment.recruiter_id,
              assigned_recruiter_at: new Date().toISOString(),
              assignment_pending_review: isPendingReview,
            })
            .eq("id", candidateId);

          console.log("[AI Interview Webhook] Assigned recruiter:", assignment.recruiter_id, "to candidate:", candidateId, isPendingReview ? "(pending review)" : "");
        }
      }
    }

    // "Other" role: create unrouted alert + send candidate email + notify managers
    if (candidate?.role_category === "Other") {
      // Insert unrouted alert
      await supabase.from("unrouted_alerts").insert({
        candidate_id: candidateId,
        ai_interview_result: passed,
      });

      // Send candidate email
      const firstName =
        (candidate.display_name || candidate.full_name || "").split(" ")[0] || "there";

      if (process.env.RESEND_API_KEY && candidate.email) {
        try {
          await sendEmail({
              from: "StaffVA <notifications@staffva.com>",
              to: candidate.email,
              subject: "You're in the queue — a Talent Specialist will be assigned to you shortly",
              html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                <h2 style="color:#1C1B1A;">You're in the Queue</h2>
                <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
                <p style="color:#444;font-size:14px;">We have reviewed your AI interview. You will be assigned a Talent Specialist within 24 hours. You will receive a notification when your Talent Specialist is assigned.</p>
                <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
              </div>`,
            });
        } catch { /* silent */ }
      }

      // Notify all recruiting managers
      const { data: managers } = await supabase
        .from("profiles")
        .select("id")
        .eq("role", "recruiting_manager");

      if (managers && managers.length > 0) {
        const candidateName = candidate.display_name || candidate.full_name || "A candidate";
        const notifications = managers.map((m: { id: string }) => ({
          manager_id: m.id,
          candidate_id: candidateId,
          message: `URGENT: ${candidateName} (Other role) completed AI interview — needs recruiter assignment.`,
        }));
        await supabase.from("manager_notifications").insert(notifications);
      }

      console.log("[AI Interview Webhook] Other role alert created for candidate:", candidateId);
    }

    // Fire and forget — don't block the response
    generateInsights(candidateId).catch((err) =>
      console.error("[AI Insights Webhook] Error:", err)
    );

    return NextResponse.json({ success: true, message: "Insights generation triggered" });
  } catch (error) {
    console.error("[AI Insights Webhook] Error:", error);
    return NextResponse.json({ error: "Failed to process" }, { status: 500 });
  }
}
