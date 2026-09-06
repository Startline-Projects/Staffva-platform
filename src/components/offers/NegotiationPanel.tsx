"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The negotiation half of an offer, both roles: the round history, whose
 * turn it is, and (when it's yours) the counter form. Accept/decline stay in
 * the host surface — this panel owns only what Atlas 4.19 added.
 */

export interface CounterRound {
  round: number;
  proposed_by: "client" | "candidate";
  hourly_rate: number;
  hours_per_week: number;
  contract_length: string;
  start_date: string;
  message: string | null;
  created_at: string;
}

const LENGTHS = ["1 month", "3 months", "6 months", "12 months", "Ongoing"];

export default function NegotiationPanel({
  offerId,
  viewer,
  currentTerms,
  signingBonus = null,
  onChanged,
  onTurnKnown,
}: {
  offerId: string;
  viewer: "client" | "candidate";
  currentTerms: { hourly_rate: number; hours_per_week: number; contract_length: string; start_date: string | null };
  /** Rides the envelope untouched by counters — surfaced so both sides see
   *  the FULL terms an accept would bind, not just the four negotiable ones. */
  signingBonus?: number | null;
  onChanged: () => void;
  /** Lets the host page hide its own accept/decline buttons off-turn. */
  onTurnKnown?: (turn: "client" | "candidate" | null) => void;
}) {
  const [rounds, setRounds] = useState<CounterRound[]>([]);
  const [turn, setTurn] = useState<"client" | "candidate" | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [rate, setRate] = useState(String(currentTerms.hourly_rate));
  const [hours, setHours] = useState(String(currentTerms.hours_per_week));
  const [length, setLength] = useState(currentTerms.contract_length);
  const [start, setStart] = useState(currentTerms.start_date?.slice(0, 10) ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onTurnRef = useRef(onTurnKnown);
  useEffect(() => {
    onTurnRef.current = onTurnKnown;
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/offers/negotiate?offerId=${encodeURIComponent(offerId)}`);
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled) return;
        setRounds(j.counters || []);
        setTurn(j.turn ?? null);
        onTurnRef.current?.(j.turn ?? null);
      } catch {
        /* history hidden; the host surface still works */
      }
    }
    const t = setTimeout(load, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [offerId]);

  async function submitCounter() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/offers/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "counter",
          offerId,
          hourlyRate: Number(rate),
          hoursPerWeek: Number(hours),
          contractLength: length,
          startDate: start,
          message: note.trim() || null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || "Could not send the counter.");
        return;
      }
      setShowForm(false);
      setNote("");
      onChanged();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const myTurn = turn === viewer;
  const other = viewer === "client" ? "candidate" : "client";

  return (
    <div className="mt-6">
      {rounds.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Negotiation history
          </p>
          <ol className="mt-2 space-y-2">
            {rounds.map((r) => (
              <li key={r.round} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                <span className="font-medium text-[#1C1B1A]">
                  Round {r.round} · {r.proposed_by === viewer ? "You" : `The ${other}`}:
                </span>{" "}
                ${r.hourly_rate}/hr · {r.hours_per_week} hrs/wk · {r.contract_length} · starts{" "}
                {new Date(r.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                {r.message && <p className="mt-1 text-xs italic text-gray-600">&ldquo;{r.message}&rdquo;</p>}
              </li>
            ))}
          </ol>
          {signingBonus != null && signingBonus > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              The ${signingBonus.toLocaleString()} signing bonus isn&apos;t part of
              the back-and-forth — it stays on whatever terms get accepted.
            </p>
          )}
        </div>
      )}

      {turn !== null && !myTurn && rounds.length > 0 && (
        <p className="mt-3 text-sm text-gray-600">
          Waiting on the {other} — they can accept, decline, or counter.
        </p>
      )}

      {myTurn && (
        <div className="mt-3">
          {!showForm ? (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="text-sm font-semibold text-[#FE6E3E] hover:underline"
            >
              Propose different terms →
            </button>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-sm font-semibold text-[#1C1B1A]">Your counter</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="text-xs text-gray-600">
                  Rate ($/hr)
                  <input type="number" min={1} max={500} value={rate} onChange={(e) => setRate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" />
                </label>
                <label className="text-xs text-gray-600">
                  Hours / week
                  <input type="number" min={1} max={60} value={hours} onChange={(e) => setHours(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" />
                </label>
                <label className="text-xs text-gray-600">
                  Length
                  <select value={length} onChange={(e) => setLength(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm">
                    {LENGTHS.map((l) => (<option key={l} value={l}>{l}</option>))}
                  </select>
                </label>
                <label className="text-xs text-gray-600">
                  Start date
                  <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" />
                </label>
              </div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="A short note (optional — no contact details)"
                className="mt-3 w-full rounded-lg border border-gray-200 p-2 text-sm"
              />
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={submitCounter}
                  disabled={busy}
                  className="rounded-full bg-[#FE6E3E] px-5 py-2 text-sm font-semibold text-white hover:bg-[#E55A2B] disabled:opacity-50"
                >
                  {busy ? "Sending…" : "Send counter"}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="text-xs text-gray-500 hover:text-gray-700">
                  Cancel
                </button>
              </div>
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
