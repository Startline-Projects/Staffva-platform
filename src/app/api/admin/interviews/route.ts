import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { generateInsights } from "@/lib/generateInsights";
import { assertRecruiterScope } from "@/lib/recruiterScope";

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

async function verifyAdminOrRecruiter() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  if (role !== "admin" && role !== "recruiter" && role !== "recruiting_manager") return null;
  return user;
}

// GET — list interviews for a candidate
export async function GET(req: NextRequest) {
  const admin = await verifyAdminOrRecruiter();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const candidateId = req.nextUrl.searchParams.get("candidateId");
  if (!candidateId) return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });

  const supabase = getAdminClient();
  const { data: interviews } = await supabase
    .from("candidate_interviews")
    .select("*")
    .eq("candidate_id", candidateId)
    .order("interview_number");

  return NextResponse.json({ interviews: interviews || [] });
}

// POST — create or update an interview
export async function POST(req: NextRequest) {
  const admin = await verifyAdminOrRecruiter();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json();
  const { action } = body;
  const supabase = getAdminClient();

  // Scope enforcement: recruiters may only act on candidates in their assigned categories
  if (admin.app_metadata?.role === "recruiter") {
    let scopeCandidateId: string | undefined = body.candidateId;

    // update_status uses interviewId — resolve the candidateId from the interview record
    if (action === "update_status" && body.interviewId) {
      const { data: interview } = await supabase
        .from("candidate_interviews")
        .select("candidate_id")
        .eq("id", body.interviewId)
        .single();
      scopeCandidateId = interview?.candidate_id;
    }

    if (!scopeCandidateId) {
      return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });
    }

    const scopeError = await assertRecruiterScope(admin.id, scopeCandidateId);
    if (scopeError) {
      return NextResponse.json({ error: scopeError.error }, { status: scopeError.status });
    }
  }

  // Request a new interview
  if (action === "request") {
    const { candidateId, interviewNumber } = body;
    if (!candidateId || !interviewNumber) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Check if interview already exists
    const { data: existing } = await supabase
      .from("candidate_interviews")
      .select("id, status")
      .eq("candidate_id", candidateId)
      .eq("interview_number", interviewNumber)
      .single();

    if (existing) {
      return NextResponse.json({
        error: `Interview ${interviewNumber} already exists (${existing.status})`,
      }, { status: 400 });
    }

    const { data: interview, error } = await supabase
      .from("candidate_interviews")
      .insert({
        candidate_id: candidateId,
        interview_number: interviewNumber,
        status: "requested",
        conducted_by: admin.id,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, interview });
  }

  // Update interview status
  if (action === "update_status") {
    const { interviewId, status, scheduledAt } = body;
    if (!interviewId || !status) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const updateData: Record<string, unknown> = { status };
    if (scheduledAt) updateData.scheduled_at = scheduledAt;

    await supabase
      .from("candidate_interviews")
      .update(updateData)
      .eq("id", interviewId);

    return NextResponse.json({ success: true });
  }

  // Complete an interview with scores and notes
  if (action === "complete") {
    const {
      interviewId,
      candidateId,
      communicationScore,
      demeanorScore,
      roleKnowledgeScore,
      notesPdfPath,
    } = body;

    if (!interviewId || !candidateId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Update interview record
    await supabase
      .from("candidate_interviews")
      .update({
        status: "completed",
        conducted_at: new Date().toISOString(),
        conducted_by: admin.id,
        communication_score: communicationScore,
        demeanor_score: demeanorScore,
        role_knowledge_score: roleKnowledgeScore,
        notes_pdf_url: notesPdfPath || null,
      })
      .eq("id", interviewId);

    // Regenerate AI insights after interview scoring (fire-and-forget)
    generateInsights(candidateId).catch((err) =>
      console.error("[Interviews] AI insights error:", err)
    );

    // Check if there's a pending client interview request to notify
    const { data: pendingRequests } = await supabase
      .from("interview_requests")
      .select("*, clients(email, full_name)")
      .eq("candidate_id", candidateId)
      .eq("payment_status", "paid")
      .is("notified_at", null);

    // Get candidate info for email
    const { data: candidate } = await supabase
      .from("candidates")
      .select("display_name, full_name")
      .eq("id", candidateId)
      .single();

    // Count completed interviews for this candidate
    const { count } = await supabase
      .from("candidate_interviews")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", candidateId)
      .eq("status", "completed");

    const completedCount = count || 0;

    // Notify clients if their requested number of interviews is met
    if (pendingRequests && pendingRequests.length > 0 && process.env.RESEND_API_KEY) {
      for (const request of pendingRequests) {
        if (completedCount >= request.interviews_requested) {
          const client = request.clients as { email: string; full_name: string } | null;
          if (client) {
            try {
              await sendEmail({
                  from: "StaffVA <noreply@staffva.com>",
                  to: client.email,
                  subject: `Interview Notes — ${candidate?.display_name || candidate?.full_name} from StaffVA`,
                  html: `<div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
                    <h2 style="color: #1c1b1a;">Interview Notes Ready</h2>
                    <p style="color: #555;">The interview${request.interviews_requested > 1 ? "s" : ""} you requested for <strong>${candidate?.display_name || candidate?.full_name}</strong> ${request.interviews_requested > 1 ? "are" : "is"} now complete.</p>
                    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
                      <p style="color: #1c1b1a; font-weight: 600; margin: 0 0 8px;">Latest Scores:</p>
                      <p style="color: #555; margin: 4px 0;">Communication Clarity: ${communicationScore}/5</p>
                      <p style="color: #555; margin: 4px 0;">Professional Demeanor: ${demeanorScore}/5</p>
                      <p style="color: #555; margin: 4px 0;">Role Knowledge: ${roleKnowledgeScore}/5</p>
                    </div>
                    <p style="color: #555;">You can view the full interview notes and download the PDF on the candidate's profile page.</p>
                    <a href="https://staffva.com/candidate/${candidateId}" style="display: inline-block; background: #fe6e3e; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">View Profile</a>
                    <p style="color: #999; margin-top: 24px; font-size: 12px;">— The StaffVA Team</p>
                  </div>`,
                });

              // Mark request as notified
              await supabase
                .from("interview_requests")
                .update({ notified_at: new Date().toISOString() })
                .eq("id", request.id);
            } catch (err) {
              console.error("Failed to notify client:", err);
            }
          }
        }
      }
    }

    return NextResponse.json({ success: true, completedCount });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
