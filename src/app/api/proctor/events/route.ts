import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getOwnCandidateId } from "@/lib/auth";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const EVENT_TYPES = new Set([
  "mouse_leave", "tab_switch", "fullscreen_exit",
  "focus_return",
  "paste_attempt", "mobile_device",
  "warning_shown", "test_started", "test_submitted",
]);
const LEAVE_TYPES = ["mouse_leave", "tab_switch", "fullscreen_exit"];
const SESSION_KINDS = new Set(["english_test", "ai_interview"]);
const MAX_BATCH = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CleanEvent {
  candidate_id: string;
  session_kind: string;
  event_type: string;
  question_number: number | null;
  client_event_id: string | null;
  duration_ms: number | null;
  at: string | null;
}

/**
 * POST /api/proctor/events — the ONE ingest for assessment-integrity events.
 *
 * Replaces two client-side writers: the EnglishTest inline block that wrote
 * test_events from the browser and never landed a single row (INSERT-only RLS
 * rejected its .select() read-back, unchecked), and FocusEnforcement's
 * cheat-log path that worked but conflated tab switches with mouse drift.
 *
 * Shape rules:
 *  - The candidate is derived from the SESSION, never from the body — there
 *    is nothing to spoof.
 *  - Events are append-only. A return is its own row, paired to its leave by
 *    client_event_id, so no id ever round-trips to the browser.
 *  - Invalid events are dropped, not rejected: a telemetry batch must never
 *    be able to interrupt a candidate's test. The response says how many
 *    were stored so a debugging session can still see the drops.
 *  - The anticheat flag recomputation the client used to orchestrate with a
 *    second call (/api/test/anticheat-check) happens here, after any batch
 *    containing countable events. Same thresholds, same flag-only shape:
 *    >= 4 leave events, or a single absence >= 10s, sets
 *    anticheat_lockout_triggered — which no code punishes automatically; it
 *    is the flag surface the proctor review queue will read.
 */
export async function POST(request: Request) {
  const candidateId = await getOwnCandidateId();
  if (!candidateId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { sessionKind?: unknown; events?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sessionKind = typeof body.sessionKind === "string" && SESSION_KINDS.has(body.sessionKind)
    ? body.sessionKind
    : "english_test";

  const rawEvents = Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH) : [];
  const clean: CleanEvent[] = [];
  for (const raw of rawEvents) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    if (typeof e.type !== "string" || !EVENT_TYPES.has(e.type)) continue;

    clean.push({
      candidate_id: candidateId,
      session_kind: sessionKind,
      event_type: e.type,
      question_number:
        typeof e.question_number === "number" && Number.isInteger(e.question_number) &&
        e.question_number >= 0 && e.question_number <= 500
          ? e.question_number : null,
      client_event_id:
        typeof e.client_event_id === "string" && UUID_RE.test(e.client_event_id)
          ? e.client_event_id : null,
      duration_ms:
        typeof e.duration_ms === "number" && Number.isFinite(e.duration_ms) &&
        e.duration_ms >= 0 && e.duration_ms <= 3_600_000
          ? Math.round(e.duration_ms) : null,
      at: typeof e.at === "string" && !Number.isNaN(Date.parse(e.at)) ? e.at : null,
    });
  }

  if (clean.length === 0) {
    return NextResponse.json({ ok: true, stored: 0 });
  }

  const supabase = getAdminClient();
  const { error: insertError } = await supabase.from("proctor_events").insert(clean);
  if (insertError) {
    // Say so and fail — a silent drop here is exactly how the last event
    // stream stayed empty for months without anyone noticing.
    console.error("[proctor-events] insert failed:", insertError.message);
    return NextResponse.json({ error: "Could not store events" }, { status: 500 });
  }

  // Recompute the flag surface when this batch could have moved it.
  const countable = clean.some(
    (e) => LEAVE_TYPES.includes(e.event_type) || e.event_type === "focus_return"
  );
  if (countable) {
    const [{ count: strikeCount }, { data: returns }] = await Promise.all([
      supabase
        .from("proctor_events")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", candidateId)
        .in("event_type", LEAVE_TYPES),
      supabase
        .from("proctor_events")
        .select("duration_ms")
        .eq("candidate_id", candidateId)
        .eq("event_type", "focus_return")
        .not("duration_ms", "is", null)
        .order("duration_ms", { ascending: false })
        .limit(1),
    ]);

    const strikes = strikeCount ?? 0;
    const maxAbsenceSeconds = Math.round(((returns?.[0]?.duration_ms ?? 0) / 1000) * 10) / 10;

    const updatePayload: Record<string, unknown> = {
      anticheat_strike_count: strikes,
      anticheat_max_absence_seconds: maxAbsenceSeconds,
    };
    if (strikes >= 4) {
      updatePayload.anticheat_lockout_triggered = true;
      updatePayload.anticheat_lockout_reason = "four_strikes";
    } else if (maxAbsenceSeconds >= 10) {
      updatePayload.anticheat_lockout_triggered = true;
      updatePayload.anticheat_lockout_reason = "ten_second_absence";
    }

    const { error: flagError } = await supabase
      .from("candidates")
      .update(updatePayload)
      .eq("id", candidateId);
    if (flagError) {
      console.error("[proctor-events] flag recompute failed:", flagError.message);
    }
  }

  return NextResponse.json({ ok: true, stored: clean.length });
}
