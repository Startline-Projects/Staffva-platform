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

const MAX_RETRIES = 3;
const BATCH_SIZE = 50;

// Runs every 30 seconds via Vercel Cron (minimum 1 minute on Hobby)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getAdminClient();
  const results = { processed: 0, failed: 0, skipped: 0, alerted: 0 };

  // Select pending records, ordered by submission time
  const { data: pendingItems } = await supabase
    .from("application_queue")
    .select("*")
    .eq("status", "pending")
    .lt("retry_count", MAX_RETRIES)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (!pendingItems || pendingItems.length === 0) {
    return NextResponse.json({ message: "No pending applications", ...results });
  }

  for (const item of pendingItems) {
    // Mark as processing to prevent double-picks
    await supabase
      .from("application_queue")
      .update({ status: "processing" })
      .eq("id", item.id)
      .eq("status", "pending"); // Optimistic lock

    try {
      await processApplication(supabase, item);

      // Mark complete
      await supabase
        .from("application_queue")
        .update({
          status: "complete",
          processed_at: new Date().toISOString(),
          error_text: null,
        })
        .eq("id", item.id);

      results.processed++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      const newRetryCount = (item.retry_count || 0) + 1;

      await supabase
        .from("application_queue")
        .update({
          status: "failed",
          error_text: `Attempt ${newRetryCount}: ${errorMsg}`,
          retry_count: newRetryCount,
        })
        .eq("id", item.id);

      results.failed++;
    }
  }

  // Check for permanently failed items (retry_count >= MAX_RETRIES)
  const { data: permanentFailures } = await supabase
    .from("application_queue")
    .select("id, user_id, application_data, error_text, retry_count, created_at")
    .eq("status", "failed")
    .gte("retry_count", MAX_RETRIES)
    .is("processed_at", null) // Not yet alerted
    .limit(20);

  if (permanentFailures && permanentFailures.length > 0 && process.env.RESEND_API_KEY) {
    const rows = permanentFailures
      .map((f) => {
        const appData = f.application_data as Record<string, unknown>;
        return `<tr>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${appData?.full_name || "Unknown"}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${appData?.email || "Unknown"}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${appData?.role_category || "Unknown"}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;color:red;">${f.error_text || "Unknown"}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">${f.retry_count}</td>
        </tr>`;
      })
      .join("");

    try {
      await resend.emails.send({
        from: "StaffVA <notifications@staffva.com>",
        to: "sam@glostaffing.com",
        subject: `⚠ ${permanentFailures.length} application(s) failed after ${MAX_RETRIES} retries`,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:700px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">Application Queue Failure Alert</h2>
            <p style="color:#444;font-size:14px;">${permanentFailures.length} application(s) failed processing after ${MAX_RETRIES} retry attempts.</p>
            <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #e0e0e0;">
              <thead>
                <tr style="background:#f9f9f9;">
                  <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Name</th>
                  <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Email</th>
                  <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Role</th>
                  <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Error</th>
                  <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:2px solid #e0e0e0;">Retries</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            <p style="color:#444;font-size:14px;">Check the <code>application_queue</code> table in Supabase for full details.</p>
          </div>
        `,
      });

      // Mark as alerted
      for (const f of permanentFailures) {
        await supabase
          .from("application_queue")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", f.id);
      }

      results.alerted = permanentFailures.length;
    } catch { /* silent */ }
  }

  // Reset failed items with retry_count < MAX_RETRIES back to pending for next run
  await supabase
    .from("application_queue")
    .update({ status: "pending" })
    .eq("status", "failed")
    .lt("retry_count", MAX_RETRIES);

  return NextResponse.json({
    message: `Processed ${results.processed}, failed ${results.failed}, alerted ${results.alerted}`,
    ...results,
  });
}

/**
 * Process a single application from the queue.
 * Writes to candidates table, triggers AI screening, sends welcome email.
 */
async function processApplication(
  supabase: ReturnType<typeof getAdminClient>,
  item: { id: string; user_id: string; application_data: unknown }
) {
  const appData = item.application_data as Record<string, unknown>;

  // Build candidate record from queued data
  const candidateRecord = {
    user_id: item.user_id,
    full_name: appData.full_name as string,
    email: appData.email as string,
    country: appData.country as string,
    role_category: appData.role_category as string,
    years_experience: appData.years_experience as string,
    hourly_rate: appData.hourly_rate as number,
    time_zone: appData.time_zone as string,
    linkedin_url: (appData.linkedin_url as string) || null,
    bio: (appData.bio as string) || null,
    us_client_experience: appData.us_client_experience as string,
    us_client_description: (appData.us_client_description as string) || null,
    has_college_degree: appData.has_college_degree as boolean,
    custom_role_description: (appData.custom_role_description as string) || null,
    skills: appData.skills || [],
    tools: appData.tools || [],
    computer_specs: (appData.computer_specs as string) || null,
    has_headset: appData.has_headset as boolean,
    has_webcam: appData.has_webcam as boolean,
    speed_test_url: (appData.speed_test_url as string) || null,
  };

  // Check for existing candidate (idempotency guard)
  const { data: existing } = await supabase
    .from("candidates")
    .select("id")
    .eq("user_id", item.user_id)
    .single();

  if (existing) {
    // Already processed — mark as complete
    return;
  }

  // Insert candidate record
  const { data: candidate, error: insertError } = await supabase
    .from("candidates")
    .insert(candidateRecord)
    .select("id")
    .single();

  if (insertError) {
    throw new Error(`Candidate insert failed: ${insertError.message}`);
  }

  // Queue AI screening (processed by separate screening queue cron)
  try {
    await supabase.from("screening_queue").insert({
      candidate_id: candidate.id,
      status: "pending",
    });
  } catch {
    // Non-fatal — screening can be queued manually later
  }

  // Send welcome email
  if (process.env.RESEND_API_KEY) {
    try {
      await resend.emails.send({
        from: "StaffVA <notifications@staffva.com>",
        to: appData.email as string,
        subject: "Application Received — Welcome to StaffVA",
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">Welcome to StaffVA</h2>
            <p style="color:#444;font-size:14px;">Hi ${(appData.full_name as string)?.split(" ")[0] || "there"},</p>
            <p style="color:#444;font-size:14px;line-height:1.6;">
              Your application has been received. Here&rsquo;s what happens next:
            </p>
            <div style="background:#f9f9f9;border-radius:8px;padding:16px;margin:16px 0;">
              <p style="margin:0 0 8px;font-size:13px;color:#444;"><strong>1.</strong> Complete the English assessment</p>
              <p style="margin:0 0 8px;font-size:13px;color:#444;"><strong>2.</strong> Record two short voice samples</p>
              <p style="margin:0 0 8px;font-size:13px;color:#444;"><strong>3.</strong> Build your profile</p>
              <p style="margin:0;font-size:13px;color:#444;"><strong>4.</strong> Our team reviews and publishes your profile</p>
            </div>
            <a href="https://staffva.com/apply" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Continue Your Application</a>
            <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
          </div>
        `,
      });
    } catch {
      // Non-fatal — email can be resent
    }
  }

  // Recruiter auto-assignment
  try {
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("recruiter_counter")
      .limit(1)
      .single();

    const counter = settings?.recruiter_counter ?? 0;
    const recruiter = counter % 2 === 0 ? "Shelly" : "Jerome";

    await supabase
      .from("candidates")
      .update({ assigned_recruiter: recruiter })
      .eq("id", candidate.id);

    await supabase
      .from("platform_settings")
      .update({ recruiter_counter: counter + 1 })
      .limit(1);
  } catch {
    // Non-fatal
  }

  // Trigger application received email (fire-and-forget)
  // Note: english_test_invitation email removed — candidates flow directly
  // into ID verification and English test in-app without needing an email gate
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://staffva.com";
  try {
    await fetch(`${siteUrl}/api/candidate-emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: candidate.id, emailType: "application_received" }),
    });
  } catch {
    // Non-fatal
  }
}
