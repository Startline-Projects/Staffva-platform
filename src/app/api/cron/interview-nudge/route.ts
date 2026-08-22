import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Runs every hour — sends 24h nudge to candidates waiting for second interview
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getAdminClient();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Find candidates who passed AI interview 24+ hours ago and still pending second interview
  const { data: candidates } = await supabase
    .from("candidates")
    .select("id")
    .in("second_interview_status", ["none", "pending"])
    .not("waiting_since", "is", null)
    .lt("waiting_since", twentyFourHoursAgo)
    .in("admin_status", ["active", "profile_review"]);

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ message: "No nudges needed", count: 0 });
  }

  let sent = 0;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";

  for (const c of candidates) {
    try {
      await fetch(`${siteUrl}/api/candidate-emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Internal server-to-server call — authenticate to the gated route.
          authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`,
        },
        body: JSON.stringify({ candidateId: c.id, emailType: "24h_nudge" }),
      });
      sent++;
    } catch { /* silent */ }

    await new Promise((r) => setTimeout(r, 100));
  }

  return NextResponse.json({ message: `Sent ${sent} nudge emails`, count: sent });
}
