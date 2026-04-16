import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { Resend } from "resend";

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

// ---------------------------------------------------------------------------
// Event processing — called from the webhook handler for each changed event
// ---------------------------------------------------------------------------

interface CalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; organizer?: boolean; self?: boolean }[];
}

function extractAttendeeName(event: CalendarEvent): string | null {
  if (event.attendees?.length) {
    const guest = event.attendees.find((a) => !a.organizer && !a.self);
    if (guest?.displayName) return guest.displayName.trim();
  }

  if (event.description) {
    const match = event.description.match(/^Name:\s*(.+)/im);
    if (match) return match[1].trim();
  }

  if (event.summary) {
    return event.summary
      .replace(/^(Meeting with|Appointment:|Interview with|Booking with)\s*/i, "")
      .trim() || null;
  }

  return null;
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts[parts.length - 1] : parts[0],
  };
}

function formatDateForEmail(iso: string | undefined): string {
  if (!iso) return "a new date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "a new date";
  return d.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export async function processCalendarEvent(
  recruiterId: string,
  event: CalendarEvent
): Promise<void> {
  const supabase = getAdminClient();
  const eventStart = event.start?.dateTime || event.start?.date || null;

  // --- Cancellation ---
  if (event.status === "cancelled") {
    const { data: candidate } = await supabase
      .from("candidates")
      .select("id, display_name, full_name, email")
      .eq("google_calendar_event_id", event.id)
      .single();

    if (!candidate) return;

    await supabase
      .from("candidates")
      .update({
        second_interview_status: "none",
        second_interview_scheduled_at: null,
        google_calendar_event_id: null,
      })
      .eq("id", candidate.id);

    console.log(`[GOOGLE CALENDAR] Cancelled booking — reverted candidate ${candidate.display_name || candidate.id} to none`);

    if (candidate.email) {
      const { data: recruiterProfile } = await supabase
        .from("profiles")
        .select("calendar_link")
        .eq("id", recruiterId)
        .single();

      const firstName = (candidate.full_name || candidate.display_name || "there").split(" ")[0];
      const calLink = recruiterProfile?.calendar_link || "";

      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: "StaffVA <notifications@staffva.com>",
          to: candidate.email,
          subject: "Your interview has been cancelled — please rebook",
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <p>Hi ${firstName},</p>
            <p>Your scheduled interview has been cancelled. Please use the link below to book a new time.</p>
            ${calLink ? `<p><a href="${calLink}" style="color:#FE6E3E;font-weight:600;">${calLink}</a></p>` : ""}
            <p style="color:#999;margin-top:32px;font-size:12px;border-top:1px solid #e0e0e0;padding-top:16px;">— The StaffVA Team</p>
          </div>`,
        });
      } catch (e) {
        console.error("[GOOGLE CALENDAR] Failed to send cancellation email:", e);
      }
    }
    return;
  }

  // --- Reschedule: existing matched event with changed start time ---
  if (event.status === "confirmed" || !event.status) {
    const { data: existing } = await supabase
      .from("candidates")
      .select("id, display_name, full_name, email, second_interview_scheduled_at")
      .eq("google_calendar_event_id", event.id)
      .single();

    if (existing) {
      const oldStart = existing.second_interview_scheduled_at
        ? new Date(existing.second_interview_scheduled_at).getTime()
        : null;
      const newStart = eventStart ? new Date(eventStart).getTime() : null;

      if (oldStart && newStart && oldStart !== newStart) {
        await supabase
          .from("candidates")
          .update({ second_interview_scheduled_at: eventStart })
          .eq("id", existing.id);

        console.log(`[GOOGLE CALENDAR] Rescheduled booking — updated candidate ${existing.display_name || existing.id}`);

        if (existing.email) {
          const firstName = (existing.full_name || existing.display_name || "there").split(" ")[0];
          try {
            const resend = new Resend(process.env.RESEND_API_KEY);
            await resend.emails.send({
              from: "StaffVA <notifications@staffva.com>",
              to: existing.email,
              subject: "Your interview has been rescheduled",
              html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                <p>Hi ${firstName},</p>
                <p>Your interview has been rescheduled to <strong>${formatDateForEmail(eventStart || undefined)}</strong>. We will see you then.</p>
                <p style="color:#999;margin-top:32px;font-size:12px;border-top:1px solid #e0e0e0;padding-top:16px;">— The StaffVA Team</p>
              </div>`,
            });
          } catch (e) {
            console.error("[GOOGLE CALENDAR] Failed to send reschedule email:", e);
          }
        }
      }
      return;
    }
  }

  // --- New booking: try to match to a candidate ---
  const attendeeName = extractAttendeeName(event);
  if (!attendeeName) {
    await supabase.from("calendar_unmatched_bookings").insert({
      recruiter_id: recruiterId,
      event_id: event.id,
      event_start: eventStart,
      attendee_name: null,
    });
    console.log("[GOOGLE CALENDAR] Unmatched booking — no attendee name found");
    return;
  }

  const { firstName, lastName } = splitName(attendeeName);

  const { data: matches } = await supabase
    .from("candidates")
    .select("id, display_name, full_name, second_interview_status")
    .eq("assigned_recruiter", recruiterId)
    .ilike("full_name", `%${firstName}%`)
    .ilike("full_name", `%${lastName}%`);

  if (matches?.length === 1) {
    const matched = matches[0];
    await supabase
      .from("candidates")
      .update({
        second_interview_status: "scheduled",
        second_interview_scheduled_at: eventStart,
        google_calendar_event_id: event.id,
      })
      .eq("id", matched.id);

    console.log(`[GOOGLE CALENDAR] Matched booking to candidate ${matched.display_name || matched.full_name}`);
  } else {
    await supabase.from("calendar_unmatched_bookings").insert({
      recruiter_id: recruiterId,
      event_id: event.id,
      event_start: eventStart,
      attendee_name: attendeeName,
    });
    console.log(`[GOOGLE CALENDAR] Unmatched booking — stored for manual review (name: ${attendeeName}, matches: ${matches?.length ?? 0})`);
  }
}
