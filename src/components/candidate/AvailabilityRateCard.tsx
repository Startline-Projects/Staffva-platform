"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The two things a live candidate most needs to change about themselves, and
 * until now could not.
 *
 * Availability has been emailed about for months — "Update my availability",
 * linking to a dashboard with no such control — and the only writer was a
 * route with no callers. Rate went through a change-request queue whose
 * promise of review the grants never backed.
 *
 * Both save through /api/candidate/update-availability, which is the only
 * writer that also refreshes the freshness stamp and settles the nudge flag.
 */

const OPTIONS = [
  {
    value: "available_now",
    label: "Available now",
    hint: "Clients can find you and you're included when they post work.",
  },
  {
    value: "available_by_date",
    label: "Available from a date",
    hint: "You stay listed, and clients see when you free up.",
  },
  {
    value: "not_available",
    label: "Not available",
    hint: "You stay on your profile but we stop matching you to new jobs.",
  },
] as const;

// Kept in step with the server's bounds (route.ts) and the CHECK constraint
// candidates_hourly_rate_range added in 00186.
const MIN_RATE = 1;
const MAX_RATE = 500;

interface Props {
  status: string;
  date: string | null;
  rate: number | null;
  hoursPerWeek: number | null;
  lastUpdated: string | null;
  stale: boolean;
}

export default function AvailabilityRateCard({
  status: initialStatus,
  date: initialDate,
  rate: initialRate,
  hoursPerWeek: initialHours,
  lastUpdated,
  stale,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus || "available_now");
  const [date, setDate] = useState(initialDate || "");
  const [rate, setRate] = useState(initialRate != null ? String(initialRate) : "");
  const [hours, setHours] = useState(initialHours != null ? String(initialHours) : "");
  // Tomorrow, in UTC to match the DATE column. Computed once on mount rather
  // than per render, which the purity lint rightly flags. A past "available
  // from" date is not a future start; the server coerces one to available_now.
  const [minDate] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const dirty =
    status !== (initialStatus || "available_now") ||
    date !== (initialDate || "") ||
    rate !== (initialRate != null ? String(initialRate) : "") ||
    hours !== (initialHours != null ? String(initialHours) : "");

  // Always enabled. Confirming an unchanged answer is a real action — it is how
  // someone says "still true" — and gating it on `stale` broke the nudge: the
  // cron emails at 30 days but staleness starts at 45, so for two weeks the
  // email's "Update my availability" button landed on a form whose Save was
  // greyed out. Re-affirming is never a no-op; the route restamps freshness.
  const canSave = true;

  async function save() {
    if (saving) return;
    // hourly_rate is NOT NULL with no "unset" state, so a blank box is not a
    // value to save. Sent as undefined it is dropped from the JSON body, the
    // request still succeeds on the availability columns, and the candidate
    // gets a green "Saved" for a rate that never changed.
    if (rate.trim() === "") {
      setSaved(false);
      setError(`Enter your hourly rate — between $${MIN_RATE} and $${MAX_RATE}.`);
      return;
    }
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/candidate/update-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          availability_status: status,
          availability_date: status === "available_by_date" ? date : null,
          hourly_rate: Number(rate),
          hours_per_week: hours === "" ? undefined : Number(hours),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "We couldn't save that. Try again.");
        return;
      }
      setSaved(true);
      // The page's visibility panel is derived server-side from exactly these
      // fields, so it has to re-read them rather than guess.
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="availability" className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Availability &amp; rate
        </h2>
        {lastUpdated && !stale && (
          <span className="text-xs text-gray-400">
            Confirmed{" "}
            {new Date(lastUpdated).toLocaleDateString("en-US", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        )}
      </div>
      <p className="mb-4 text-sm text-gray-600">
        This is what clients see. Changing it takes effect on the marketplace
        straight away — no review, no waiting.
      </p>

      <fieldset className="space-y-2">
        <legend className="sr-only">Your availability</legend>
        {OPTIONS.map((o) => (
          <label
            key={o.value}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
              status === o.value
                ? "border-[#FE6E3E] bg-orange-50/50"
                : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <input
              type="radio"
              name="availability"
              value={o.value}
              checked={status === o.value}
              onChange={() => setStatus(o.value)}
              className="mt-1 accent-[#FE6E3E]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[#1C1B1A]">{o.label}</span>
              <span className="block text-xs text-gray-500">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {status === "available_by_date" && (
        <div className="mt-3">
          <label htmlFor="avail-date" className="block text-xs font-medium text-gray-600">
            Available from
          </label>
          <input
            id="avail-date"
            type="date"
            value={date}
            min={minDate}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-[#FE6E3E] focus:outline-none"
          />
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="rate" className="block text-xs font-medium text-gray-600">
            Your hourly rate
          </label>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-sm text-gray-500">$</span>
            <input
              id="rate"
              type="number"
              min={MIN_RATE}
              max={MAX_RATE}
              step="0.5"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-[#FE6E3E] focus:outline-none"
            />
            <span className="text-sm text-gray-500">/hr</span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Contracts you&apos;ve already signed keep the rate they were agreed at.
          </p>
        </div>
        <div>
          <label htmlFor="hours" className="block text-xs font-medium text-gray-600">
            Hours a week you want
          </label>
          <input
            id="hours"
            type="number"
            min={1}
            max={60}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className="mt-1 w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-[#FE6E3E] focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">Helps clients size the work.</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={!canSave || saving}
          className="rounded-full bg-[#FE6E3E] px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#E55A2B] disabled:opacity-40"
        >
          {saving ? "Saving…" : stale && !dirty ? "Yes, still accurate" : "Save changes"}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
        {saved && !error && (
          <span className="text-sm text-green-700">Saved — clients see this now.</span>
        )}
      </div>
    </section>
  );
}
