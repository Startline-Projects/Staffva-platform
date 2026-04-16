import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createCalendarWatch } from "@/lib/google-calendar";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getAdminClient();
  const twentyFourHoursFromNow = new Date(
    Date.now() + 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id")
    .eq("google_calendar_connected", true)
    .lt("google_watch_expiry", twentyFourHoursFromNow);

  const results: { id: string; success: boolean; error?: string }[] = [];

  for (const profile of profiles || []) {
    try {
      await createCalendarWatch(profile.id);
      results.push({ id: profile.id, success: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[RENEW WATCH] Failed for ${profile.id}:`, msg);
      results.push({ id: profile.id, success: false, error: msg });
    }
  }

  const renewed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return NextResponse.json({ renewed, failed, total: results.length });
}
