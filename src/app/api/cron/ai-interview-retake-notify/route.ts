import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Runs hourly — notifies candidates whose 3-day AI interview retake lockout has
// expired. Sends at most one retake-ready email per fail cycle; the webhook
// resets ai_interview_retake_notified_at to null on every new fail.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getAdminClient();
  const nowIso = new Date().toISOString();

  // Pull candidates sitting in the fail gate who have not yet been notified.
  // We do not join interview_attempts in this query because PostgREST filters
  // on related tables don't reliably prune the outer set — we fetch the latest
  // attempt row per candidate below.
  const { data: candidates, error: candidatesErr } = await supabase
    .from("candidates")
    .select("id, email, display_name, full_name")
    .eq("admin_status", "ai_interview_failed")
    .is("ai_interview_retake_notified_at", null);

  if (candidatesErr) {
    console.error("[retake-notify] candidate query failed:", candidatesErr);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ message: "No candidates waiting", count: 0 });
  }

  let notified = 0;
  const skipped: string[] = [];

  for (const candidate of candidates) {
    // Latest interview_attempts row is the one that gates the current fail cycle.
    // Deliberately NOT filtered by kind: a candidate serves one cooldown at
    // a time, and the newest attempt is it — Interview 1 or Interview 2.
    const { data: attempt } = await supabase
      .from("interview_attempts")
      .select("next_retake_available_at")
      .eq("candidate_id", candidate.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!attempt?.next_retake_available_at) {
      skipped.push(candidate.id);
      continue;
    }

    if (attempt.next_retake_available_at > nowIso) {
      // Retake window hasn't opened yet — leave the notification flag untouched.
      continue;
    }

    if (process.env.RESEND_API_KEY && candidate.email) {
      const firstName =
        (candidate.display_name || candidate.full_name || "").split(" ")[0] || "there";
      try {
        await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: candidate.email,
            subject: "Your StaffVA retake is ready — start your AI interview now",
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Your retake is ready</h2>
              <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
              <p style="color:#444;font-size:14px;">Your 3-day wait is over. You can log in and retake your AI interview now.</p>
              <a href="https://staffva.com/candidate/dashboard" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Retake My AI Interview</a>
              <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
            </div>`,
          }, { recipientKind: "candidate", emailType: "interview_retake" });

      } catch (err) {
        console.error("[retake-notify] Resend threw for", candidate.id, err);
        skipped.push(candidate.id);
        continue;
      }
    }

    // Stamp the candidate so we never email them twice for the same fail cycle.
    const { error: updateErr } = await supabase
      .from("candidates")
      .update({ ai_interview_retake_notified_at: nowIso })
      .eq("id", candidate.id);

    if (updateErr) {
      console.error("[retake-notify] stamp update failed for", candidate.id, updateErr);
      skipped.push(candidate.id);
      continue;
    }

    notified++;
  }

  return NextResponse.json({
    message: `Notified ${notified} candidate(s)`,
    count: notified,
    skipped: skipped.length,
  });
}
