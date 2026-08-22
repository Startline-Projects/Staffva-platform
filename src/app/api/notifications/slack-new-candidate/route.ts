import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ownsCandidate } from "@/lib/auth";

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

    // Previously unauthenticated: anyone could reassign a candidate's recruiter
    // and push their PII into the Slack channel.
    if (!(await ownsCandidate(candidate_id))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const supabase = getAdminClient();

    // --- Recruiter auto-assignment ---
    // Route by role_category via recruiter_assignments.
    // Fallback (no routing row, or role_category === "Other"): assign to Manar
    // and flag assignment_pending_review so it surfaces in the admin "Needs Routing" queue.
    const MANAR_RECRUITING_MANAGER_ID = "73da7f50-b637-4b8d-a38e-7ae36e2acfd5";
    let assignedRecruiter = "Manar"; // display string for Slack message body
    try {
      const { data: candidateRow } = await supabase
        .from("candidates")
        .select("role_category")
        .eq("id", candidate_id)
        .maybeSingle();

      const roleCategory = candidateRow?.role_category as string | undefined;
      let matchedId: string | null = null;
      if (roleCategory && roleCategory !== "Other") {
        const { data: assignment } = await supabase
          .from("recruiter_assignments")
          .select("recruiter_id")
          .eq("role_category", roleCategory)
          .limit(1)
          .maybeSingle();
        matchedId = assignment?.recruiter_id ?? null;
      }

      const assignedRecruiterId = matchedId ?? MANAR_RECRUITING_MANAGER_ID;
      const pendingReview = !matchedId;

      const { data: recruiterProfile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", assignedRecruiterId)
        .maybeSingle();
      assignedRecruiter = recruiterProfile?.full_name || assignedRecruiter;

      await supabase
        .from("candidates")
        .update({
          assigned_recruiter: assignedRecruiterId,
          assigned_recruiter_at: new Date().toISOString(),
          assignment_pending_review: pendingReview,
        })
        .eq("id", candidate_id);
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
