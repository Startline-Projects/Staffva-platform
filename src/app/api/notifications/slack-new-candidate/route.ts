import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    const { candidate_id } = await req.json();
    if (!candidate_id) {
      return NextResponse.json({ error: "Missing candidate_id" }, { status: 400 });
    }

    const supabase = getAdminClient();

    // --- Round-robin recruiter assignment ---
    let assignedRecruiter = "Shelly";
    try {
      const { data: settings } = await supabase
        .from("platform_settings")
        .select("id, recruiter_counter")
        .limit(1)
        .single();

      if (settings) {
        const counter = settings.recruiter_counter || 0;
        assignedRecruiter = counter % 2 === 0 ? "Shelly" : "Jerome";

        // Assign to candidate
        await supabase
          .from("candidates")
          .update({ assigned_recruiter: assignedRecruiter })
          .eq("id", candidate_id);

        // Increment counter
        await supabase
          .from("platform_settings")
          .update({ recruiter_counter: counter + 1 })
          .eq("id", settings.id);
      }
    } catch {
      // Silent — don't block on assignment failure
    }

    // --- Slack notification ---
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;

    const { data: candidate } = await supabase
      .from("candidates")
      .select("id, display_name, role_category, country, screening_tag, screening_score")
      .eq("id", candidate_id)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    // If no webhook URL, still return success (assignment already done)
    if (!webhookUrl) {
      return NextResponse.json({ success: true, assigned: assignedRecruiter, slack: "skipped" });
    }

    const tagEmoji: Record<string, string> = {
      Priority: "🟢",
      Review: "🟡",
      Hold: "🔘",
    };
    const emoji = tagEmoji[candidate.screening_tag || "Review"] || "🟡";
    const tag = candidate.screening_tag || "Review";
    const score = candidate.screening_score || "N/A";

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";

    const slackMessage = {
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "📋 New Candidate Application",
            emoji: true,
          },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Name:*\n${candidate.display_name}`,
            },
            {
              type: "mrkdwn",
              text: `*Role:*\n${candidate.role_category}`,
            },
            {
              type: "mrkdwn",
              text: `*Country:*\n${candidate.country}`,
            },
            {
              type: "mrkdwn",
              text: `*AI Screening:*\n${emoji} ${tag} (${score}/10)`,
            },
          ],
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Assigned to:*\n${assignedRecruiter}`,
            },
          ],
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Review in Admin Panel",
                emoji: true,
              },
              url: `${siteUrl}/admin/candidates`,
              style: "primary",
            },
          ],
        },
      ],
    };

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slackMessage),
    });

    return NextResponse.json({ success: true, assigned: assignedRecruiter });
  } catch (err) {
    console.error("Slack notification error:", err);
    return NextResponse.json({ success: true, error: "Notification failed silently" });
  }
}
