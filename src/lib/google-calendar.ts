import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
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

// ---------------------------------------------------------------------------
// Event processing — called from the webhook handler for each changed event
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; organizer?: boolean; self?: boolean }[];
}

// ---------------------------------------------------------------------------
// Match-hardening (per Scope v6.6 Section 11E) — the new-booking branch must
// reject on any of five safeguards. The pure decision function below is what
// the tests exercise; processCalendarEvent wires Supabase I/O around it.
// ---------------------------------------------------------------------------

export type UnmatchReason =
  | "no_identifying_email"
  | "ambiguous_match"
  | "event_before_assignment"
  | "existing_booking_collision"
  | "status_not_eligible_for_overwrite"
  | "event_not_confirmed";

export interface CandidateMatchRow {
  id: string;
  email: string;
  created_at: string;
  ai_interview_completed_at: string | null;
  assigned_recruiter_at: string | null;
  second_interview_status: string | null;
  google_calendar_event_id: string | null;
}

export type MatchDecision =
  | { kind: "match"; candidateId: string; candidateEmail: string; usedCreatedAtFloor: boolean }
  | { kind: "unmatched"; reason: UnmatchReason; attendeeEmail: string | null };

// Returns the attendee emails on `event` that are NOT organizer/self and whose
// domain is NOT in `internalDomains`. Lowercased. Used for both the
// internal-only pre-filter and the downstream candidates.email lookup.
export function extractExternalAttendees(
  event: CalendarEvent,
  internalDomains: Set<string>,
): string[] {
  if (!event.attendees?.length) return [];
  const out: string[] = [];
  for (const a of event.attendees) {
    if (!a.email) continue;
    if (a.organizer || a.self) continue;
    const domain = a.email.split("@")[1]?.toLowerCase();
    if (!domain) continue;
    if (internalDomains.has(domain)) continue;
    out.push(a.email.toLowerCase());
  }
  return out;
}

// Human-readable name for calendar_unmatched_bookings.attendee_name (operator
// triage column). Best-effort; returns null when nothing usable.
export function extractAttendeeName(event: CalendarEvent): string | null {
  if (event.attendees?.length) {
    const guest = event.attendees.find((a) => !a.organizer && !a.self);
    if (guest?.displayName) return guest.displayName.trim();
  }
  if (event.description) {
    const m = event.description.match(/^Name:\s*(.+)/im);
    if (m) return m[1].trim();
  }
  if (event.summary) {
    return event.summary.replace(/^(Meeting with|Appointment:|Interview with|Booking with)\s*/i, "").trim() || null;
  }
  return null;
}

// Pure decision function — given an event and the candidate rows whose email
// matches one of the event's external attendees (already filtered by
// assigned_recruiter = this recruiter), decide whether to link, and if not,
// which unmatch reason to record. No I/O; safe to unit-test directly.
export function decideMatchOutcome(params: {
  event: CalendarEvent;
  eventStart: string | null;
  externalEmails: string[];
  candidateMatches: CandidateMatchRow[];
}): MatchDecision {
  const { event, eventStart, externalEmails, candidateMatches } = params;
  const firstExternal = externalEmails[0] ?? null;

  // Safeguard E — event must be confirmed
  if (event.status && event.status !== "confirmed") {
    return { kind: "unmatched", reason: "event_not_confirmed", attendeeEmail: firstExternal };
  }

  // Safeguard A — email-based identity
  if (candidateMatches.length === 0) {
    return { kind: "unmatched", reason: "no_identifying_email", attendeeEmail: firstExternal };
  }
  if (candidateMatches.length > 1) {
    return { kind: "unmatched", reason: "ambiguous_match", attendeeEmail: firstExternal };
  }

  const c = candidateMatches[0];

  // Safeguard B — event cannot predate assignment floor
  //   floor = assigned_recruiter_at -> ai_interview_completed_at -> created_at
  const floorIso = c.assigned_recruiter_at ?? c.ai_interview_completed_at ?? c.created_at;
  const usedCreatedAtFloor = !c.assigned_recruiter_at && !c.ai_interview_completed_at;
  if (eventStart && floorIso) {
    const eventMs = new Date(eventStart).getTime();
    const floorMs = new Date(floorIso).getTime();
    if (Number.isFinite(eventMs) && Number.isFinite(floorMs) && eventMs < floorMs) {
      return { kind: "unmatched", reason: "event_before_assignment", attendeeEmail: c.email };
    }
  }

  // Safeguard C — no silent overwrite of a different existing linkage
  if (c.google_calendar_event_id && c.google_calendar_event_id !== event.id) {
    return { kind: "unmatched", reason: "existing_booking_collision", attendeeEmail: c.email };
  }

  // Safeguard D — status must be 'none' or NULL
  if (c.second_interview_status && c.second_interview_status !== "none") {
    return { kind: "unmatched", reason: "status_not_eligible_for_overwrite", attendeeEmail: c.email };
  }

  return { kind: "match", candidateId: c.id, candidateEmail: c.email, usedCreatedAtFloor };
}

export async function recordUnmatched(
  supabase: ReturnType<typeof getAdminClient>,
  recruiterId: string,
  event: CalendarEvent,
  eventStart: string | null,
  reason: UnmatchReason,
  attendeeEmail: string | null,
): Promise<void> {
  await supabase
    .from("calendar_unmatched_bookings")
    .upsert(
      {
        recruiter_id: recruiterId,
        event_id: event.id,
        event_start: eventStart,
        attendee_name: extractAttendeeName(event),
        attendee_email: attendeeEmail,
        unmatch_reason: reason,
      },
      { onConflict: "recruiter_id,event_id", ignoreDuplicates: true },
    );
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
        await sendEmail({
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
            await sendEmail({
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

  // --- New booking: email-scoped hardened match (5 safeguards) ---

  // Refinement 2 — internal-only pre-filter. Pull the recruiter's email once
  // so we can treat their own domain + @staffva.com as "internal". Any event
  // whose attendees are entirely within that set is skipped with NO row
  // written to calendar_unmatched_bookings (prevents "Team Morning Huddle"
  // style logspam seen in prod — 4000 of 4003 rows pre-migration).
  const { data: recruiterProfile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", recruiterId)
    .single();
  const internalDomains = new Set<string>(["staffva.com"]);
  const recruiterDomain = recruiterProfile?.email?.split("@")[1]?.toLowerCase();
  if (recruiterDomain) internalDomains.add(recruiterDomain);

  const externalEmails = extractExternalAttendees(event, internalDomains);
  if (externalEmails.length === 0) {
    console.debug(
      `[GOOGLE CALENDAR] Skipping internal-only event ${event.id} — no external attendees`
    );
    return;
  }

  // Pull candidate rows for Safeguard A evaluation, scoped to this recruiter.
  const { data: candidateMatches } = await supabase
    .from("candidates")
    .select(
      "id, email, created_at, ai_interview_completed_at, assigned_recruiter_at, second_interview_status, google_calendar_event_id, display_name, full_name"
    )
    .in("email", externalEmails)
    .eq("assigned_recruiter", recruiterId);

  const decision = decideMatchOutcome({
    event,
    eventStart,
    externalEmails,
    candidateMatches: (candidateMatches ?? []) as CandidateMatchRow[],
  });

  if (decision.kind === "unmatched") {
    await recordUnmatched(supabase, recruiterId, event, eventStart, decision.reason, decision.attendeeEmail);
    console.log(
      `[GOOGLE CALENDAR] Unmatched booking — event=${event.id} reason=${decision.reason} email=${decision.attendeeEmail ?? "<none>"}`
    );
    return;
  }

  // decision.kind === "match" — all safeguards passed.
  if (decision.usedCreatedAtFloor) {
    console.warn(
      `[GOOGLE CALENDAR] Safeguard B floor fell back to candidates.created_at for legacy candidate ${decision.candidateId} — assigned_recruiter_at and ai_interview_completed_at both NULL`
    );
  }

  await supabase
    .from("candidates")
    .update({
      second_interview_status: "scheduled",
      second_interview_scheduled_at: eventStart,
      google_calendar_event_id: event.id,
    })
    .eq("id", decision.candidateId);

  // If this event previously sat in calendar_unmatched_bookings (e.g. failed
  // Safeguard A before the candidate was assigned), drop the stale row now
  // that the linkage has been written.
  await supabase
    .from("calendar_unmatched_bookings")
    .delete()
    .eq("recruiter_id", recruiterId)
    .eq("event_id", event.id);

  console.log(
    `[GOOGLE CALENDAR] Matched booking ${event.id} to candidate ${decision.candidateId} (${decision.candidateEmail})`
  );
}
