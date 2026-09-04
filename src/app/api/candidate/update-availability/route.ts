import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { recordStatusEvent } from "@/lib/reviewOutcome";

/**
 * A live candidate changing their own availability and rate.
 *
 * This route existed and had no callers anywhere in the product. It also read
 * an `Authorization: Bearer` header, unlike every sibling candidate route,
 * which is probably why nobody ever wired it up. Meanwhile a cron has been
 * emailing live candidates a button labelled "Update my availability" that
 * lands them on a dashboard with no such control — and 26 of the 31 are now
 * permanently flagged `needs_availability_update` with no code path able to
 * clear it, because the only writer was this unreachable route.
 *
 * Rate is here too, and directly rather than through review. Two reasons, both
 * checked rather than assumed: every money path reads a snapshot
 * (engagements.candidate_rate_usd, frozen contract HTML) so a rate change
 * cannot disturb a live engagement — three of the eight already diverge from
 * their candidate's current rate, including released ones that paid correctly.
 * And the review gate was never real: `authenticated` has held a direct UPDATE
 * grant on hourly_rate all along, so the copy promising a recruiter check was
 * describing something the database did not do.
 */

const VALID_STATUS = new Set(["available_now", "available_by_date", "not_available"]);
const MIN_RATE = 1;
const MAX_RATE = 500;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const {
    availability_status: status,
    availability_date: date,
    hours_per_week: hours,
    working_hours: workingHours,
    hourly_rate: rate,
  } = body as Record<string, unknown>;

  const patch: Record<string, unknown> = {};

  if (status !== undefined) {
    if (typeof status !== "string" || !VALID_STATUS.has(status)) {
      return NextResponse.json({ error: "Pick one of the three availability options." }, { status: 400 });
    }
    patch.availability_status = status;
    // "Available by" without a date is not an answer.
    if (status === "available_by_date") {
      if (typeof date !== "string" || !date || Number.isNaN(Date.parse(date))) {
        return NextResponse.json(
          { error: "Tell us the date you're available from." },
          { status: 400 }
        );
      }
      // A date that is today or already past means "available now", and is
      // stored that way. Nothing in the platform rolls a lapsed date forward,
      // and every query — the browse RPC, /api/jobs, /api/match — matches on
      // the raw enum, so a stale `available_by_date` row would sit excluded
      // from immediate-start work indefinitely while its card advertised a
      // date in the past. Coercing here keeps the column true by construction
      // instead of asking four readers to compensate.
      //
      // Compared as calendar dates in UTC: availability_date is a DATE column
      // with no zone, so parsing "2026-09-04" gives UTC midnight.
      const today = new Date();
      const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
      if (Date.parse(date) <= todayUtc) {
        patch.availability_status = "available_now";
        patch.availability_date = null;
      } else {
        patch.availability_date = date;
      }
    } else {
      patch.availability_date = null;
    }
  }

  if (hours !== undefined && hours !== null && hours !== "") {
    const n = Number(hours);
    if (!Number.isFinite(n) || n < 1 || n > 60) {
      return NextResponse.json({ error: "Hours a week must be between 1 and 60." }, { status: 400 });
    }
    patch.hours_per_week = Math.round(n);
  }

  if (typeof workingHours === "string") {
    patch.working_hours = workingHours.slice(0, 120) || null;
  }

  let rateChange: { from: number | null; to: number } | null = null;
  if (rate !== undefined && rate !== null && rate !== "") {
    const n = Number(rate);
    // The HTML min/max on the old edit modal were attributes only — no server
    // check and no database CHECK existed on this column at all.
    if (!Number.isFinite(n) || n < MIN_RATE || n > MAX_RATE) {
      return NextResponse.json(
        { error: `Your rate needs to be between $${MIN_RATE} and $${MAX_RATE} an hour.` },
        { status: 400 }
      );
    }
    patch.hourly_rate = n;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const db = admin();
  // postgrest-js resolves a failed request to { data: null, error } rather than
  // throwing (shouldThrowOnError defaults false), so an unbound error here
  // would turn a dropped connection into "No candidate profile" — telling a
  // live candidate their account is gone.
  const { data: candidate, error: lookupError } = await db
    .from("candidates")
    .select("id, hourly_rate, admin_status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupError) {
    console.error("[update-availability] lookup failed:", lookupError.message);
    return NextResponse.json({ error: "We couldn't save that." }, { status: 500 });
  }
  if (!candidate) return NextResponse.json({ error: "No candidate profile" }, { status: 404 });

  if (patch.hourly_rate !== undefined && patch.hourly_rate !== candidate.hourly_rate) {
    rateChange = { from: candidate.hourly_rate ?? null, to: patch.hourly_rate as number };
  }

  // Availability answered now is availability we can trust.
  //
  // This overlaps the 00186 trigger but is not redundant: the trigger only
  // stamps when the VALUE changes, deliberately, so that re-saving an identical
  // answer cannot launder a stale one. Re-affirmation is different — a
  // candidate pressing "Yes, still accurate" is new information even though
  // nothing changed — and only this route can tell the two apart, because only
  // it knows the press happened. The browser holds no grant on these three
  // columns, so a candidate still cannot mark their own answer fresh directly.
  if (patch.availability_status !== undefined) {
    patch.availability_last_updated_at = new Date().toISOString();
    patch.needs_availability_update = false;
    patch.availability_nudge_sent_at = null;
  }

  const { error } = await db.from("candidates").update(patch).eq("id", candidate.id);
  if (error) {
    console.error("[update-availability] failed:", error.message);
    return NextResponse.json({ error: "We couldn't save that." }, { status: 500 });
  }

  // A rate has a history now. It is the number a candidate is most likely to
  // change and the one a dispute is most likely to be about.
  if (rateChange) {
    await recordStatusEvent({
      candidateId: candidate.id,
      from: candidate.admin_status ?? null,
      to: candidate.admin_status ?? "active",
      actorId: user.id,
      actorRole: "candidate",
      reason: `rate changed from ${rateChange.from ?? "unset"} to ${rateChange.to}`,
    });
  }

  return NextResponse.json({ ok: true });
}
