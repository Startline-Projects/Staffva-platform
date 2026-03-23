import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

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
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { candidateId, action, speakingLevel, revisionNote } = await request.json();

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
        <p style="color: #555;">Please update your profile based on this feedback. Once you make the changes, our team will review again within 2 business days.</p>
        <a href="https://staffva.com/apply" style="display: inline-block; background: #fe6e3e; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">Edit Your Profile</a>
        <p style="color: #999; margin-top: 24px; font-size: 12px;">— The StaffVA Team</p>
      </div>`
    );

    return NextResponse.json({ success: true, action: "revision_required" });
  }

  if (action === "flag") {
    return NextResponse.json({ success: true, action: "flagged" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
