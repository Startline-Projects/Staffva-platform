import { createClient } from "@supabase/supabase-js";

/**
 * Server-side wrapper for the Daily.co REST API — interview rooms and the
 * meeting tokens that gate them. Server-only: the API key must never reach a
 * browser, and there is no dashboard allowlist protecting rooms — a private
 * room plus per-participant tokens is the ENTIRE access control, which is
 * why every token here pins room_name and an expiry (a token without
 * room_name opens every room in the domain; one without exp never expires).
 *
 * Failures land in vendor_failures so alert-health surfaces them; callers
 * get null and turn it into an honest "video is down" message, never a
 * silent success.
 */

const BASE = "https://api.daily.co/v1";

// How early a room can be joined, and how long past the scheduled end it
// stays alive before Daily ejects everyone and deletes the room. Interviews
// that run long are fine; rooms that live forever are how a leaked link
// becomes a standing meeting spot.
export const JOIN_EARLY_MS = 15 * 60 * 1000;
export const OVERRUN_MS = 45 * 60 * 1000;

export function dailyConfigured(): boolean {
  return !!process.env.DAILY_API_KEY;
}

async function recordVendorFailure(operation: string, fatal: boolean, message: string, context: Record<string, unknown>) {
  try {
    await createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      .from("vendor_failures")
      .insert({
        app: "platform",
        vendor: "daily",
        operation,
        fatal,
        message: message.slice(0, 2000),
        context,
      });
  } catch (err) {
    console.error("[daily] could not record vendor failure:", err);
  }
}

async function dailyFetch(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.DAILY_API_KEY}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

export interface InterviewRoom {
  name: string;
  url: string;
}

/**
 * Create (or fetch, if a concurrent request won the create) the private room
 * for one booking. Deterministic name — both parties racing to provision
 * converge on the same room.
 */
export async function ensureInterviewRoom(booking: {
  id: string;
  startsAt: Date;
  durationMinutes: number;
}): Promise<InterviewRoom | null> {
  const name = `interview-${booking.id}`;
  const nbf = Math.floor((booking.startsAt.getTime() - JOIN_EARLY_MS) / 1000);
  const exp = Math.floor(
    (booking.startsAt.getTime() + booking.durationMinutes * 60_000 + OVERRUN_MS) / 1000
  );

  try {
    const created = await dailyFetch("/rooms", {
      method: "POST",
      body: JSON.stringify({
        name,
        privacy: "private",
        properties: {
          nbf,
          exp,
          eject_at_room_exp: true,
          enable_recording: "cloud",
          enable_knocking: false,
          enable_screenshare: true,
          enable_chat: true,
          enable_prejoin_ui: true,
        },
      }),
    });

    if (created.ok && typeof created.body.url === "string") {
      return { name, url: created.body.url };
    }

    // The other party's request may have created it a moment ago. Don't key
    // this on the 400 body's exact prose — any create failure is worth one
    // lookup before declaring the room unreachable.
    const existing = await dailyFetch(`/rooms/${name}`);
    if (existing.ok && typeof existing.body.url === "string") {
      return { name, url: existing.body.url };
    }

    await recordVendorFailure(
      "room.create",
      created.status === 401 || created.status === 403,
      `HTTP ${created.status}: ${JSON.stringify(created.body)}`,
      { bookingId: booking.id }
    );
    return null;
  } catch (err) {
    await recordVendorFailure("room.create", false, err instanceof Error ? err.message : String(err), {
      bookingId: booking.id,
    });
    return null;
  }
}

/**
 * Mint one participant's token for one room. NOBODY is a room owner: an
 * owner token keeps stopRecording/eject/mute powers through the daily-js
 * API even with the recording UI hidden, and recording is a property of
 * the interview, not a button either party gets to press. The client's
 * arrival still starts the cloud recording — start_cloud_recording is its
 * own grant and needs no ownership.
 */
export async function mintMeetingToken(opts: {
  roomName: string;
  userName: string;
  startsRecording: boolean;
  expUnix: number;
  bookingId: string;
}): Promise<string | null> {
  try {
    const res = await dailyFetch("/meeting-tokens", {
      method: "POST",
      body: JSON.stringify({
        properties: {
          room_name: opts.roomName,
          user_name: opts.userName.slice(0, 80),
          is_owner: false,
          exp: opts.expUnix,
          enable_recording_ui: false,
          ...(opts.startsRecording ? { start_cloud_recording: true } : {}),
        },
      }),
    });
    if (res.ok && typeof res.body.token === "string") return res.body.token;

    await recordVendorFailure(
      "token.mint",
      res.status === 401 || res.status === 403,
      `HTTP ${res.status}: ${JSON.stringify(res.body)}`,
      { bookingId: opts.bookingId }
    );
    return null;
  } catch (err) {
    await recordVendorFailure("token.mint", false, err instanceof Error ? err.message : String(err), {
      bookingId: opts.bookingId,
    });
    return null;
  }
}

/**
 * Delete a booking's room, if it exists. Called on cancellation: deleting
 * the private room ejects anyone already joined and turns every minted
 * token into a key for a door that no longer exists — which also closes
 * the window where a token minted mid-cancel would still work.
 */
export async function deleteInterviewRoom(roomName: string, bookingId: string): Promise<void> {
  if (!dailyConfigured()) return;
  try {
    const res = await dailyFetch(`/rooms/${roomName}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      await recordVendorFailure("room.delete", false, `HTTP ${res.status}: ${JSON.stringify(res.body)}`, {
        bookingId,
      });
    }
  } catch (err) {
    await recordVendorFailure("room.delete", false, err instanceof Error ? err.message : String(err), {
      bookingId,
    });
  }
}

/**
 * One cheap authenticated call, for health checks: does the key work?
 * Returns an error description, or null when healthy.
 */
export async function dailyHealthProbe(): Promise<string | null> {
  if (!dailyConfigured()) return "DAILY_API_KEY is not set";
  try {
    const res = await dailyFetch("/");
    if (res.ok) return null;
    return `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
