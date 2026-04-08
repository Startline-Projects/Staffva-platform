import { NextRequest, NextResponse } from "next/server";
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

    // Check if this candidate passed the AI interview
    const { data: aiInterview } = await supabase
      .from("ai_interviews")
      .select("passed")
      .eq("candidate_id", candidateId)
      .eq("status", "completed")
      .eq("passed", true)
      .limit(1)
      .maybeSingle();

    // Auto-assign recruiter based on role_category
    const { data: candidate } = await supabase
      .from("candidates")
      .select("role_category, email, display_name, full_name")
      .eq("id", candidateId)
      .single();

    if (candidate?.role_category) {
      const { data: assignment } = await supabase
        .from("recruiter_assignments")
        .select("recruiter_id")
        .eq("role_category", candidate.role_category)
        .limit(1)
        .maybeSingle();

      if (assignment?.recruiter_id) {
        const isPendingReview = candidate.role_category === "Other";
        await supabase
          .from("candidates")
          .update({
            assigned_recruiter: assignment.recruiter_id,
            assignment_pending_review: isPendingReview,
          })
          .eq("id", candidateId);

        console.log("[AI Interview Webhook] Assigned recruiter:", assignment.recruiter_id, "to candidate:", candidateId, isPendingReview ? "(pending review)" : "");
      }
    }

    // "Other" role: create unrouted alert + send candidate email + notify managers
    if (candidate?.role_category === "Other") {
      // Insert unrouted alert
      await supabase.from("unrouted_alerts").insert({
        candidate_id: candidateId,
        ai_interview_result: !!aiInterview,
      });

      // Send candidate email
      const firstName =
        (candidate.display_name || candidate.full_name || "").split(" ")[0] || "there";

      if (process.env.RESEND_API_KEY && candidate.email) {
        try {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "StaffVA <notifications@staffva.com>",
              to: candidate.email,
              subject: "You're in the queue — a Talent Specialist will be assigned to you shortly",
              html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                <h2 style="color:#1C1B1A;">You're in the Queue</h2>
                <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
                <p style="color:#444;font-size:14px;">We have reviewed your AI interview. You will be assigned a Talent Specialist within 24 hours. You will receive a notification when your Talent Specialist is assigned.</p>
                <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
              </div>`,
            }),
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
