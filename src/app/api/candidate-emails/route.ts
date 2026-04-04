import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type EmailType =
  | "application_received"
  | "english_test_invitation"
  | "english_test_passed"
  | "ai_interview_passed"
  | "24h_nudge"
  | "second_interview_scheduled"
  | "profile_approved";

interface EmailTemplate {
  subject: string;
  body: (name: string, data?: Record<string, string>) => string;
}

const TEMPLATES: Record<EmailType, EmailTemplate> = {
  application_received: {
    subject: "Your StaffVA application is in",
    body: (name) => `
      <h2 style="color:#1C1B1A;">Application Received</h2>
      <p>Hi ${name},</p>
      <p>Your application to StaffVA has been received. You can continue your application process right now — no need to wait.</p>
      <p><strong>Next steps:</strong></p>
      <ul>
        <li>Complete identity verification</li>
        <li>Take the English assessment (15 minutes)</li>
        <li>Record voice samples</li>
        <li>Build your profile</li>
      </ul>
      <p>Candidates who complete all steps are eligible for our $3,000 monthly giveaway.</p>
      <a href="https://staffva.com/apply" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Continue Application</a>
    `,
  },

  english_test_invitation: {
    subject: "Complete your English test — StaffVA",
    body: (name) => `
      <h2 style="color:#1C1B1A;">Your English Test is Ready</h2>
      <p>Hi ${name},</p>
      <p>Your English assessment is ready. This test includes grammar and reading comprehension sections and takes approximately 15 minutes.</p>
      <p><strong>Important:</strong></p>
      <ul>
        <li>You need a quiet environment and a stable internet connection</li>
        <li>The test is timed — 15 minutes total</li>
        <li>You cannot pause or retake the test once started</li>
        <li>Completing the English test is required for giveaway eligibility</li>
      </ul>
      <a href="https://staffva.com/apply" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Start English Test</a>
    `,
  },

  english_test_passed: {
    subject: "You passed — next step inside",
    body: (name, data) => `
      <h2 style="color:#1C1B1A;">Congratulations, ${name}!</h2>
      <p>You passed the StaffVA English assessment${data?.tier ? ` with a <strong>${data.tier}</strong> rating` : ""}.</p>
      <p><strong>Your next step:</strong> Complete an AI-powered interview. This is a short structured conversation that evaluates your communication skills and professional experience.</p>
      <p>You are one step closer to giveaway eligibility. Complete the AI interview to continue.</p>
      <a href="https://staffva.com/apply" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Continue Application</a>
    `,
  },

  ai_interview_passed: {
    subject: "AI interview complete — recruiter will be in touch within 48 hours",
    body: (name, data) => `
      <h2 style="color:#1C1B1A;">AI Interview Complete</h2>
      <p>Hi ${name},</p>
      <p>You completed the AI interview${data?.score ? ` with a score of <strong>${data.score}/100</strong>` : ""}. Well done.</p>
      <p><strong>What happens next:</strong> A recruiter from our team will reach out to you within <strong>48 hours</strong> to schedule a brief second interview. This is the final step before your profile goes live.</p>
      <p>Giveaway eligibility is now one step away — complete the recruiter interview and get your profile approved to qualify.</p>
      <a href="https://staffva.com/candidate/dashboard" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">View Dashboard</a>
    `,
  },

  "24h_nudge": {
    subject: "Your recruiter interview is being scheduled",
    body: (name) => `
      <h2 style="color:#1C1B1A;">We Haven't Forgotten You</h2>
      <p>Hi ${name},</p>
      <p>Your AI interview is complete and a recruiter is preparing to schedule your second interview. We aim to reach out within 48 hours of your AI interview completion.</p>
      <p>In the meantime, make sure your profile is up to date — a complete profile helps our team match you with the right opportunities faster.</p>
      <a href="https://staffva.com/candidate/dashboard" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Update My Profile</a>
    `,
  },

  second_interview_scheduled: {
    subject: "Your StaffVA interview is confirmed",
    body: (name, data) => `
      <h2 style="color:#1C1B1A;">Interview Scheduled</h2>
      <p>Hi ${name},</p>
      <p>Your second interview with StaffVA has been confirmed.</p>
      <div style="background:#f9f9f9;border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin:16px 0;">
        <p style="margin:0 0 8px;"><strong>Date:</strong> ${data?.date || "See your dashboard"}</p>
        <p style="margin:0 0 8px;"><strong>Time:</strong> ${data?.time || "See your dashboard"}</p>
        ${data?.link ? `<p style="margin:0;"><strong>Video call:</strong> <a href="${data.link}" style="color:#FE6E3E;">${data.link}</a></p>` : ""}
      </div>
      <p><strong>Preparation tips:</strong></p>
      <ul>
        <li>Be in a quiet environment with good lighting</li>
        <li>Test your microphone and camera beforehand</li>
        <li>Have a brief summary of your work experience ready</li>
        <li>The interview lasts approximately 20 minutes</li>
      </ul>
    `,
  },

  profile_approved: {
    subject: "You are live on StaffVA",
    body: (name, data) => `
      <h2 style="color:#1C1B1A;">Your Profile is Live!</h2>
      <p>Hi ${name},</p>
      <p>Congratulations — your StaffVA profile has been approved and is now visible to clients. U.S. businesses can now find you, view your profile, and reach out about opportunities.</p>
      ${data?.profileUrl ? `<a href="${data.profileUrl}" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">View My Live Profile</a>` : ""}
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="margin:0;color:#166534;font-weight:600;">Giveaway Eligibility Confirmed</p>
        <p style="margin:8px 0 0;color:#166534;font-size:13px;">You have completed all required steps and are now eligible for our monthly giveaway. Winners are announced on the first of each month.</p>
      </div>
      <p>Share your profile with colleagues — the more professionals on StaffVA, the stronger the network for everyone.</p>
    `,
  },
};

// POST — Send a triggered email (idempotent — won't send duplicates)
export async function POST(req: NextRequest) {
  try {
    const { candidateId, emailType, data } = await req.json() as {
      candidateId: string;
      emailType: EmailType;
      data?: Record<string, string>;
    };

    if (!candidateId || !emailType) {
      return NextResponse.json({ error: "Missing candidateId or emailType" }, { status: 400 });
    }

    const template = TEMPLATES[emailType];
    if (!template) {
      return NextResponse.json({ error: `Unknown email type: ${emailType}` }, { status: 400 });
    }

    const supabase = getAdminClient();

    // Idempotency check — don't send duplicates
    const { data: existing } = await supabase
      .from("candidate_emails")
      .select("id")
      .eq("candidate_id", candidateId)
      .eq("email_type", emailType)
      .eq("status", "sent")
      .single();

    if (existing) {
      return NextResponse.json({ sent: false, reason: "already_sent" });
    }

    // Get candidate info
    const { data: candidate } = await supabase
      .from("candidates")
      .select("email, display_name, full_name, id")
      .eq("id", candidateId)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    const firstName = (candidate.display_name || candidate.full_name || "").split(" ")[0] || "there";

    if (!process.env.RESEND_API_KEY) {
      // Log without sending
      await supabase.from("candidate_emails").insert({
        candidate_id: candidateId,
        email_type: emailType,
        status: "skipped_no_api_key",
      });
      return NextResponse.json({ sent: false, reason: "no_api_key" });
    }

    // Send email
    try {
      await resend.emails.send({
        from: "StaffVA <notifications@staffva.com>",
        to: candidate.email,
        subject: template.subject,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
          ${template.body(firstName, data)}
          <p style="color:#999;margin-top:32px;font-size:12px;border-top:1px solid #e0e0e0;padding-top:16px;">— The StaffVA Team</p>
        </div>`,
      });

      // Log success
      await supabase.from("candidate_emails").insert({
        candidate_id: candidateId,
        email_type: emailType,
        status: "sent",
      });

      return NextResponse.json({ sent: true, emailType });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Send failed";

      await supabase.from("candidate_emails").insert({
        candidate_id: candidateId,
        email_type: emailType,
        status: `failed: ${msg}`,
      });

      return NextResponse.json({ sent: false, error: msg });
    }
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
