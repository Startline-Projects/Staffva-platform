import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh if within 5 minutes of expiry

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function getValidAccessToken(recruiterId: string): Promise<string> {
  const supabase = getAdminClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("google_access_token, google_refresh_token, google_token_expiry")
    .eq("id", recruiterId)
    .single();

  if (error || !profile?.google_access_token) {
    throw new Error("No Google tokens found for recruiter");
  }

  const expiry = profile.google_token_expiry
    ? new Date(profile.google_token_expiry).getTime()
    : 0;

  if (Date.now() + TOKEN_REFRESH_BUFFER_MS < expiry) {
    return profile.google_access_token;
  }

  if (!profile.google_refresh_token) {
    throw new Error("Token expired and no refresh token available");
  }

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: profile.google_refresh_token,
    grant_type: "refresh_token",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Token refresh failed: ${data.error || res.status}`);
  }

  const newExpiry = new Date(
    Date.now() + (data.expires_in ?? 3600) * 1000
  ).toISOString();

  await supabase
    .from("profiles")
    .update({
      google_access_token: data.access_token,
      google_token_expiry: newExpiry,
    })
    .eq("id", recruiterId);

  return data.access_token;
}

export async function createCalendarWatch(recruiterId: string): Promise<string> {
  const accessToken = await getValidAccessToken(recruiterId);
  const channelId = randomUUID();
  const expiration = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

  const webhookAddress =
    (process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com") +
    "/api/recruiter/google/webhook";

  const res = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/primary/events/watch`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: webhookAddress,
        expiration,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Calendar watch creation failed: ${err}`);
  }

  const supabase = getAdminClient();
  await supabase
    .from("profiles")
    .update({
      google_watch_channel_id: channelId,
      google_watch_expiry: new Date(expiration).toISOString(),
    })
    .eq("id", recruiterId);

  return channelId;
}
