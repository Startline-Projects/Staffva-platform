"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/**
 * The slot picker on a candidate's public profile. Reads open slots from
 * candidate_open_slots() (public, times only) and books through the
 * book_interview RPC — the engine enforces every rule, this component only
 * renders what it is offered and reports what it is told.
 *
 * Times render in the VIEWER'S timezone; slots that land outside the
 * candidate's waking hours are tinted and, on selection, say so plainly
 * ("9:00 PM for Maria in Manila") — a US client booking a Manila candidate
 * at 4 AM their time is a no-show factory, and the fix is a sentence.
 */

interface Props {
  candidateId: string;
  candidateFirstName: string;
  candidateTz: string;
  isLoggedIn: boolean;
  clientId: string | null;
  profilePath: string;
}

interface Booking {
  id: string;
  starts_at: string;
}

function viewerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function partsInZone(iso: string, tz: string) {
  const d = new Date(iso);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
    return {
      time: `${get("hour")}:${get("minute")} ${get("dayPeriod")}`,
      day: `${get("weekday")}, ${get("month")} ${get("day")}`,
      hour24: parseInt(
        new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(d),
        10
      ),
    };
  } catch {
    return { time: d.toISOString().slice(11, 16), day: d.toISOString().slice(0, 10), hour24: d.getUTCHours() };
  }
}

export default function InterviewScheduler({
  candidateId,
  candidateFirstName,
  candidateTz,
  isLoggedIn,
  clientId,
  profilePath,
}: Props) {
  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState("");
  const [existing, setExisting] = useState<Booking | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [justBooked, setJustBooked] = useState(false);

  const vz = useMemo(() => viewerZone(), []);
  const sameZone = vz === candidateTz;

  const loadSlots = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc("candidate_open_slots", { p_candidate_id: candidateId });
    const list: string[] = Array.isArray(data)
      ? data.map((r: { starts_at: string }) => r.starts_at).sort()
      : [];
    setSlots(list);
    setLoading(false);
  }, [candidateId]);

  useEffect(() => {
    async function run() {
      await loadSlots();
      if (clientId) {
        const supabase = createClient();
        const { data } = await supabase
          .from("interview_bookings")
          .select("id, starts_at")
          .eq("client_id", clientId)
          .eq("candidate_id", candidateId)
          .eq("status", "booked")
          .maybeSingle();
        if (data) setExisting(data);
      }
    }
    run();
  }, [candidateId, clientId, loadSlots]);

  // Group slots by viewer-local calendar day.
  const days = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of slots) {
      const key = partsInZone(s, vz).day;
      map.set(key, [...(map.get(key) || []), s]);
    }
    return [...map.entries()];
  }, [slots, vz]);

  async function book() {
    if (!selectedSlot || booking) return;
    setBooking(true);
    setError("");
    // The route wraps the same book_interview RPC and adds what a browser
    // can't: confirmation emails with calendar invites to both parties.
    const res = await fetch("/api/interviews/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId, startsAt: selectedSlot }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Could not book that slot.");
      setBooking(false);
      setSelectedSlot(null);
      loadSlots(); // the slot may have just been taken — show the truth
      return;
    }
    setExisting({ id: data.id as string, starts_at: selectedSlot });
    setJustBooked(true);
    setBooking(false);
  }

  async function cancelExisting() {
    if (!existing || cancelling) return;
    setCancelling(true);
    const res = await fetch("/api/interviews/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId: existing.id }),
    });
    setCancelling(false);
    if (res.ok) {
      setExisting(null);
      setJustBooked(false);
      setSelectedSlot(null);
      loadSlots();
    }
  }

  // ── Existing / just-booked state ──
  if (existing) {
    const p = partsInZone(existing.starts_at, vz);
    const theirs = partsInZone(existing.starts_at, candidateTz);
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-text">
          {justBooked ? "Interview booked" : "Your upcoming interview"}
        </h3>
        <p className="mt-2 text-sm text-text">
          {p.day} at <span className="font-semibold">{p.time}</span>
        </p>
        <p className="mt-0.5 text-xs text-text-tertiary">
          30 minutes · video call on StaffVA
          {!sameZone && ` · ${theirs.time} for ${candidateFirstName}`}
        </p>
        {justBooked && (
          <p className="mt-2 text-xs text-text-secondary">
            A confirmation with a calendar invite is on its way to your email.
          </p>
        )}
        <div className="mt-4 flex items-center gap-4">
          <Link
            href={`/interviews/${existing.id}`}
            className="text-xs font-semibold text-text underline decoration-border underline-offset-2"
          >
            View interview
          </Link>
          <button
            onClick={cancelExisting}
            disabled={cancelling}
            className="text-xs text-text-tertiary underline decoration-border underline-offset-2 hover:text-text disabled:opacity-40"
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        </div>
      </div>
    );
  }

  // ── Empty / loading ──
  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-text">Book an interview</h3>
        <p className="mt-2 text-xs text-text-tertiary">Checking the calendar…</p>
      </div>
    );
  }
  if (days.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-text">Book an interview</h3>
        <p className="mt-2 text-xs leading-relaxed text-text-tertiary">
          No open interview times in the next two weeks. Send a message instead —
          {" "}{candidateFirstName} can suggest a time.
        </p>
      </div>
    );
  }

  const activeDay = selectedDay ?? days[0]?.[0] ?? null;
  const daySlots = days.find(([d]) => d === activeDay)?.[1] || [];
  const sel = selectedSlot ? partsInZone(selectedSlot, vz) : null;
  const selTheirs = selectedSlot ? partsInZone(selectedSlot, candidateTz) : null;
  const selUnsociable = selTheirs ? selTheirs.hour24 < 7 || selTheirs.hour24 >= 21 : false;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <h3 className="text-sm font-semibold text-text">Book an interview</h3>
      <p className="mt-0.5 text-xs text-text-tertiary">
        30 minutes · video call on StaffVA · times in your timezone
      </p>

      <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
        {days.slice(0, 14).map(([day, list]) => {
          const short = day.replace(/^(\w+), (\w+) (\d+)$/, "$1 $3");
          const active = day === activeDay;
          return (
            <button
              key={day}
              onClick={() => {
                setSelectedDay(day);
                setSelectedSlot(null);
                setError("");
              }}
              className={
                active
                  ? "shrink-0 rounded-lg bg-text px-3 py-1.5 text-xs font-semibold text-white"
                  : "shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-text-secondary hover:border-gray-400"
              }
            >
              {short}
              <span className={active ? "ml-1.5 opacity-60" : "ml-1.5 text-text-tertiary"}>{list.length}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {daySlots.map((s) => {
          const mine = partsInZone(s, vz);
          const theirs = partsInZone(s, candidateTz);
          const unsociable = theirs.hour24 < 7 || theirs.hour24 >= 21;
          const active = s === selectedSlot;
          return (
            <button
              key={s}
              onClick={() => {
                setSelectedSlot(s);
                setError("");
              }}
              title={sameZone ? undefined : `${theirs.time} for ${candidateFirstName}`}
              className={
                active
                  ? "rounded-lg bg-text px-2 py-1.5 text-xs font-semibold text-white"
                  : `rounded-lg border border-gray-200 px-2 py-1.5 text-xs hover:border-gray-400 ${
                      unsociable ? "text-amber-700" : "text-text-secondary"
                    }`
              }
            >
              {mine.time}
            </button>
          );
        })}
      </div>

      {selectedSlot && sel && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <p className="text-sm text-text">
            {sel.day} at <span className="font-semibold">{sel.time}</span>
          </p>
          {!sameZone && selTheirs && (
            <p className={`mt-0.5 text-xs ${selUnsociable ? "text-amber-700" : "text-text-tertiary"}`}>
              That&apos;s {selTheirs.time} for {candidateFirstName}
              {selUnsociable ? " — outside their usual hours, expect them to be flexible but human" : ""}
            </p>
          )}

          {!isLoggedIn ? (
            <Link
              href={`/login?next=${encodeURIComponent(profilePath)}`}
              className="mt-3 block w-full rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-primary/90"
            >
              Sign in to book
            </Link>
          ) : !clientId ? (
            <p className="mt-3 text-xs text-text-tertiary">
              Interviews are booked from a client account.
            </p>
          ) : (
            <button
              onClick={book}
              disabled={booking}
              className="mt-3 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {booking ? "Booking…" : "Confirm booking"}
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    </div>
  );
}
