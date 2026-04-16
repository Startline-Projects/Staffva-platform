import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "@/lib/google-calendar";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const channelId = req.headers.get("x-goog-channel-id");
  if (!channelId) return new Response(null, { status: 200 });

  const supabase = getAdminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("google_watch_channel_id", channelId)
    .single();

  if (!profile) return new Response(null, { status: 200 });

  const recruiterId = profile.id;

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(recruiterId);
  } catch (e) {
    console.error("[GOOGLE WEBHOOK] Token refresh failed for", recruiterId, e);
    return new Response(null, { status: 200 });
  }

  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const eventsUrl = new URL(
    `${GOOGLE_CALENDAR_API}/calendars/primary/events`
  );
  eventsUrl.searchParams.set("updatedMin", tenMinutesAgo);
  eventsUrl.searchParams.set("singleEvents", "true");
  eventsUrl.searchParams.set("orderBy", "updated");

  try {
    const res = await fetch(eventsUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      console.error("[GOOGLE WEBHOOK] Events fetch failed:", res.status, await res.text());
      return new Response(null, { status: 200 });
    }

    const data = await res.json();
    const events = data.items || [];

    for (const event of events) {
      // Step 3 will replace this with processCalendarEvent(recruiterId, event)
      console.log(
        `[GOOGLE WEBHOOK] Event for recruiter ${recruiterId}:`,
        event.id,
        event.summary,
        event.start?.dateTime || event.start?.date
      );
    }
  } catch (e) {
    console.error("[GOOGLE WEBHOOK] Error fetching events:", e);
  }

  return new Response(null, { status: 200 });
}
