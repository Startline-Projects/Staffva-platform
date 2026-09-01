"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/**
 * The candidate's interview calendar: recurring weekly hours in their own
 * timezone, plus blocked dates. Clients book directly from what is published
 * here — no confirmation step — so the page is honest about that ("times you
 * list are times you can be booked") and shows the real bookable-slot count
 * after every save.
 *
 * Windows are edited locally and saved as a set (delete-then-insert of the
 * candidate's own rows; RLS scopes both). The brief empty window during a
 * save fails SAFE: the booking engine refuses slots with no covering window,
 * so a mid-save booking attempt is rejected, never mis-booked.
 */

interface Win {
  start: number; // minutes from midnight, candidate-local
  end: number;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS = [1, 2, 3, 4, 5];

function fmt(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 || h24 === 24 ? "AM" : "PM";
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => i * 30);

export default function AvailabilityPage() {
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [tz, setTz] = useState("UTC");
  const [approved, setApproved] = useState(false);

  const [days, setDays] = useState<Win[][]>(() => Array.from({ length: 7 }, () => []));
  const [blackouts, setBlackouts] = useState<{ id: string; day: string }[]>([]);
  const [newBlackout, setNewBlackout] = useState("");
  // The date-input floor, computed once on mount — not per render, which the
  // purity lint rightly flags.
  const [tomorrow] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const hasInvalidWindow = days.some((wins) => wins.some((w) => w.start >= w.end));
  const [slotCount, setSlotCount] = useState<number | null>(null);

  async function refreshSlotCount(id: string) {
    const supabase = createClient();
    const { data } = await supabase.rpc("candidate_open_slots", { p_candidate_id: id });
    setSlotCount(Array.isArray(data) ? data.length : null);
  }

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setSignedOut(true);
        setLoading(false);
        return;
      }
      const { data: c } = await supabase
        .from("candidates")
        .select("id, time_zone, admin_status")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (!c) {
        setSignedOut(true);
        setLoading(false);
        return;
      }
      setCandidateId(c.id);
      setTz(c.time_zone || "UTC");
      setApproved(c.admin_status === "approved");

      const [{ data: wins }, { data: blocks }] = await Promise.all([
        supabase
          .from("candidate_availability")
          .select("weekday, start_minute, end_minute")
          .eq("candidate_id", c.id)
          .order("start_minute"),
        supabase
          .from("candidate_availability_blackouts")
          .select("id, day")
          .eq("candidate_id", c.id)
          .gte("day", new Date().toISOString().slice(0, 10))
          .order("day"),
      ]);

      const next: Win[][] = Array.from({ length: 7 }, () => []);
      for (const w of wins || []) {
        next[w.weekday].push({ start: w.start_minute, end: w.end_minute });
      }
      setDays(next);
      setBlackouts(blocks || []);
      if (c.admin_status === "approved" && (wins || []).length > 0) {
        refreshSlotCount(c.id);
      }
      setLoading(false);
    })();
  }, []);

  function editDay(weekday: number, fn: (wins: Win[]) => Win[]) {
    setDays((d) => d.map((w, i) => (i === weekday ? fn(w) : w)));
    setDirty(true);
    setSlotCount(null);
  }

  function addWindow(weekday: number) {
    editDay(weekday, (w) => [...w, { start: 9 * 60, end: 17 * 60 }].slice(0, 3));
  }

  function copyToWeekdays(from: number) {
    setDays((d) => d.map((w, i) => (WEEKDAYS.includes(i) ? d[from].map((x) => ({ ...x })) : w)));
    setDirty(true);
    setSlotCount(null);
  }

  async function save() {
    if (!candidateId || saving || hasInvalidWindow) return;
    setSaving(true);
    setSaveError("");
    const supabase = createClient();

    // No silent filtering: save is blocked while any window is invalid, so
    // what the candidate sees on screen is exactly what gets published — a
    // dropped window meant someone believed they were bookable when nothing
    // was saved.
    const rows = days.flatMap((wins, weekday) =>
      wins.map((w) => ({
        candidate_id: candidateId,
        weekday,
        start_minute: w.start,
        end_minute: w.end,
      }))
    );

    const { error: delError } = await supabase
      .from("candidate_availability")
      .delete()
      .eq("candidate_id", candidateId);
    if (delError) {
      setSaveError("Could not save. Please try again.");
      setSaving(false);
      return;
    }
    if (rows.length > 0) {
      const { error: insError } = await supabase.from("candidate_availability").insert(rows);
      if (insError) {
        setSaveError("Could not save your hours. Please try again.");
        setSaving(false);
        return;
      }
    }
    setDirty(false);
    setSaving(false);
    if (approved) await refreshSlotCount(candidateId);
  }

  async function addBlackout() {
    if (!candidateId || !newBlackout) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("candidate_availability_blackouts")
      .insert({ candidate_id: candidateId, day: newBlackout })
      .select("id, day")
      .single();
    if (!error && data) {
      setBlackouts((b) => [...b, data].sort((x, y) => x.day.localeCompare(y.day)));
      setNewBlackout("");
      setSlotCount(null);
      if (approved) refreshSlotCount(candidateId);
    }
  }

  async function removeBlackout(id: string) {
    if (!candidateId) return;
    const supabase = createClient();
    await supabase.from("candidate_availability_blackouts").delete().eq("id", id);
    setBlackouts((b) => b.filter((x) => x.id !== id));
    if (approved) refreshSlotCount(candidateId);
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm text-text/50">Loading your calendar…</p>
      </main>
    );
  }

  if (signedOut) {
    return (
      <main className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="text-xl font-semibold text-text">Interview availability</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Sign in to your candidate account to set the hours clients can book you.
        </p>
        <Link
          href="/login?next=/candidate/availability"
          className="mt-6 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark"
        >
          Sign in
        </Link>
      </main>
    );
  }

  const hasAnyHours = days.some((w) => w.length > 0);

  return (
    <main className="mx-auto max-w-3xl px-6 pb-24 pt-12">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text">Interview availability</h1>
        <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-text-secondary">
          Clients book interviews directly from the hours you list here, so only
          list times you can genuinely take a call. All times are in your
          timezone{" "}
          <span className="font-medium text-text">{tz.replace("_", " ")}</span>;
          clients see them converted to theirs.
        </p>
      </div>

      {!approved && (
        <div className="mb-6 rounded-xl border border-border bg-card px-5 py-4">
          <p className="text-sm text-text-secondary">
            Your calendar goes live to clients once your profile is approved.
            Setting it now means you can be booked from day one.
          </p>
        </div>
      )}

      {/* ── Weekly hours ── */}
      <section className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border-light px-6 py-4">
          <h2 className="text-sm font-semibold text-text">Weekly hours</h2>
          {days[1].length > 0 && (
            <button
              onClick={() => copyToWeekdays(1)}
              className="text-xs text-text-tertiary underline decoration-border underline-offset-2 hover:text-text"
            >
              Copy Monday to all weekdays
            </button>
          )}
        </div>

        <div className="divide-y divide-border-light/70">
          {DAY_NAMES.map((name, weekday) => (
            <div key={name} className="flex flex-wrap items-start gap-x-6 gap-y-2 px-6 py-3.5">
              <span className="w-24 pt-1.5 text-xs font-medium uppercase tracking-wide text-text/50">
                {name}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {days[weekday].length === 0 && (
                  <span className="pt-1.5 text-sm text-text-tertiary">Unavailable</span>
                )}
                {days[weekday].map((w, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={w.start}
                      onChange={(e) =>
                        editDay(weekday, (wins) =>
                          wins.map((x, j) => (j === i ? { ...x, start: Number(e.target.value) } : x))
                        )
                      }
                      className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-text focus:border-text focus:outline-none"
                    >
                      {TIME_OPTIONS.slice(0, -1).map((m) => (
                        <option key={m} value={m}>{fmt(m)}</option>
                      ))}
                    </select>
                    <span className="text-text-tertiary">–</span>
                    <select
                      value={w.end}
                      onChange={(e) =>
                        editDay(weekday, (wins) =>
                          wins.map((x, j) => (j === i ? { ...x, end: Number(e.target.value) } : x))
                        )
                      }
                      className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-text focus:border-text focus:outline-none"
                    >
                      {TIME_OPTIONS.slice(1).map((m) => (
                        <option key={m} value={m}>{fmt(m)}</option>
                      ))}
                      <option value={1440}>{fmt(1440 - 30)} + 30m</option>
                    </select>
                    {w.start >= w.end && (
                      <span className="text-xs text-red-600">ends before it starts</span>
                    )}
                    <button
                      onClick={() => editDay(weekday, (wins) => wins.filter((_, j) => j !== i))}
                      className="ml-1 text-text-tertiary hover:text-text"
                      aria-label={`Remove ${name} window`}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {days[weekday].length > 0 && days[weekday].length < 3 && (
                  <button
                    onClick={() => addWindow(weekday)}
                    className="self-start text-xs text-text-tertiary underline decoration-border underline-offset-2 hover:text-text"
                  >
                    Add another window
                  </button>
                )}
              </div>
              {days[weekday].length === 0 && (
                <button
                  onClick={() => addWindow(weekday)}
                  className="pt-1 text-xs font-medium text-primary hover:text-primary-dark"
                >
                  Add hours
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-light px-6 py-4">
          <p className="text-xs text-text-tertiary">
            {slotCount !== null
              ? `Clients can book ${slotCount} time${slotCount === 1 ? "" : "s"} over the next two weeks.`
              : dirty
                ? "Unsaved changes."
                : hasAnyHours
                  ? "Interviews are 30 minutes each."
                  : "No hours listed — clients cannot book you."}
          </p>
          <div className="flex items-center gap-3">
            {hasInvalidWindow && (
              <span className="text-xs text-red-600">Fix the highlighted window to save</span>
            )}
            {saveError && <span className="text-xs text-red-600">{saveError}</span>}
            <button
              onClick={save}
              disabled={!dirty || saving || hasInvalidWindow}
              className="rounded-full bg-primary px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save hours"}
            </button>
          </div>
        </div>
      </section>

      {/* ── Blocked dates ── */}
      <section className="mt-6 rounded-xl border border-border bg-card">
        <div className="border-b border-border-light px-6 py-4">
          <h2 className="text-sm font-semibold text-text">Blocked dates</h2>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Days off, holidays, appointments — no bookings on these dates.
          </p>
        </div>
        <div className="px-6 py-4">
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={newBlackout}
              min={tomorrow}
              onChange={(e) => setNewBlackout(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-text focus:border-text focus:outline-none"
            />
            <button
              onClick={addBlackout}
              disabled={!newBlackout}
              className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-text transition-colors hover:border-text disabled:opacity-40"
            >
              Block this date
            </button>
          </div>
          {blackouts.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {blackouts.map((b) => (
                <button
                  key={b.id}
                  onClick={() => removeBlackout(b.id)}
                  title="Click to unblock"
                  className="group rounded-full bg-text px-3 py-1 text-xs font-medium text-white"
                >
                  {new Date(b.day + "T00:00:00").toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}{" "}
                  <span className="opacity-50 group-hover:opacity-100">×</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
