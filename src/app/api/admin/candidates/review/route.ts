import { NextResponse } from "next/server";
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.user_metadata?.role === "admin" ? user : null;
}

async function verifyAdminOrRecruiter() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = user?.user_metadata?.role;
  if (role !== "admin" && role !== "recruiter" && role !== "recruiting_manager") return null;
  return user;
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) {
    console.log("Resend not configured — skipping email to", to);
    return;
  }

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "StaffVA <noreply@staffva.com>",
        to,
        subject,
        html,
      }),
    });
  } catch (err) {
    console.error("Failed to send email:", err);
  }
}

// POST — approve, reject, revision_required, or flag a candidate
export async function POST(request: Request) {
  const body = await request.json();
  const { candidateId, action, speakingLevel, revisionNote } = body;

  // revision_required is open to recruiters and admins; all other actions are admin-only
  if (action === "revision_required") {
    const caller = await verifyAdminOrRecruiter();
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    if (caller.user_metadata?.role === "recruiter") {
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
  }

  if (!candidateId || !action) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Get candidate info for emails
  const { data: candidate } = await supabase
    .from("candidates")
    .select("full_name, email, id")
    .eq("id", candidateId)
    .single();

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  if (action === "approve") {
    if (!speakingLevel) {
      return NextResponse.json(
        { error: "Speaking level required for approval" },
        { status: 400 }
      );
    }

    await supabase
      .from("candidates")
      .update({
        admin_status: "approved",
        speaking_level: speakingLevel,
      })
      .eq("id", candidateId);

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
        <p style="color: #555;">Your speaking level has been assessed as: <strong>${speakingLevel}</strong></p>
        <a href="https://staffva.com/candidate/me" style="display: inline-block; background: #fe6e3e; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">View Your Profile</a>
        <p style="color: #999; margin-top: 24px; font-size: 12px;">— The StaffVA Team</p>
      </div>`
    );

    // Trigger 7: Profile approved email
    try {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";
      fetch(`${siteUrl}/api/candidate-emails`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          emailType: "profile_approved",
          data: { profileUrl: `https://staffva.com/candidate/${candidateId}` },
        }),
      }).catch(() => {});
    } catch { /* non-fatal */ }

    return NextResponse.json({ success: true, action: "approved" });
  }

  if (action === "reject") {
    await supabase
      .from("candidates")
      .update({ admin_status: "rejected" })
      .eq("id", candidateId);

    await sendEmail(
      candidate.email,
      "Update on your StaffVA application",
      `<div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #1c1b1a;">Hi ${candidate.full_name},</h2>
        <p style="color: #555;">Thank you for your interest in joining StaffVA. After reviewing your application and assessments, we are unable to approve your profile at this time.</p>
        <p style="color: #555;">This does not reflect on your abilities — our current openings require a specific skill match. We encourage you to continue developing your skills and reapply in the future.</p>
        <p style="color: #999; margin-top: 24px; font-size: 12px;">— The StaffVA Team</p>
      </div>`
    );

    return NextResponse.json({ success: true, action: "rejected" });
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
      </div>`
    );

    return NextResponse.json({ success: true, action: "revision_required" });
  }

  if (action === "flag") {
    return NextResponse.json({ success: true, action: "flagged" });
  }

  if (action === "update_spoken_score") {
    const { spokenScore, spokenResult } = body;
    if (!spokenScore || spokenScore < 1 || spokenScore > 100) {
      return NextResponse.json({ error: "Score must be between 1 and 100" }, { status: 400 });
    }
    if (spokenResult !== "pass" && spokenResult !== "fail") {
      return NextResponse.json({ error: "Result must be pass or fail" }, { status: 400 });
    }

    const supabaseAdmin = getAdminClient();

    // Set admin_status based on result
    const newAdminStatus = spokenResult === "pass" ? "under_review" : "rejected";

    await supabaseAdmin
      .from("candidates")
      .update({
        spoken_english_score: spokenScore,
        spoken_english_result: spokenResult,
        admin_status: newAdminStatus,
      })
      .eq("id", candidateId);

    // If pass — send "profile under review" email
    if (spokenResult === "pass") {
      const { data: candidate } = await supabaseAdmin
        .from("candidates")
        .select("email, display_name, full_name")
        .eq("id", candidateId)
        .single();

      if (candidate?.email) {
        const firstName = (candidate.display_name || candidate.full_name || "").split(" ")[0] || "there";
        await sendEmail(
          candidate.email,
          "Your StaffVA profile is under review",
          `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">Profile Under Review</h2>
            <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
            <p style="color:#444;font-size:14px;">Thank you for completing your Talent Specialist interview. Our team is now reviewing your profile, voice recordings, and experience.</p>
            <p style="color:#444;font-size:14px;">We will be in touch within 2 business days.</p>
            <a href="https://staffva.com/candidate/dashboard" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">View Dashboard</a>
            <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
          </div>`
        );
      }
    }

    // If fail — send rejection email
    if (spokenResult === "fail") {
      const { data: candidate } = await supabaseAdmin
        .from("candidates")
        .select("email, display_name, full_name")
        .eq("id", candidateId)
        .single();

      if (candidate?.email) {
        const firstName = (candidate.display_name || candidate.full_name || "").split(" ")[0] || "there";
        await sendEmail(
          candidate.email,
          "Your StaffVA application was not successful",
          `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">Application Update</h2>
            <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
            <p style="color:#444;font-size:14px;">Thank you for completing your interviews with StaffVA. After careful review, we are unable to approve your application at this time.</p>
            <p style="color:#444;font-size:14px;">You are welcome to reapply in 90 days. We encourage you to continue building your skills and experience.</p>
            <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
          </div>`
        );
      }
    }

    return NextResponse.json({
      success: true,
      action: "spoken_score_updated",
      adminStatus: newAdminStatus,
    });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
