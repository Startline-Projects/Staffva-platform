"use client";

import { useEffect, useRef, useState } from "react";
import type { SavedSearchFilters } from "@/lib/savedSearch";

/**
 * "Save this search" beside the result count.
 *
 * It stores the filter set the client is looking at right now, so opening it
 * later reproduces this exact page — not an approximation of it. The email
 * options are the two the digest cron actually sends. Atlas offers
 * "immediately" as well; nothing watches the pool in real time, so it is not
 * on the menu.
 *
 * Hidden for anyone who is not a signed-in client, for the same reason the
 * heart is: there is nowhere to save it to.
 */
export default function SaveSearchButton({
  enabled,
  filters,
  matchCount,
}: {
  enabled: boolean;
  filters: SavedSearchFilters;
  matchCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [notify, setNotify] = useState<"off" | "daily" | "weekly">("off");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Changing the filters makes the confirmation stale — it described the old
  // set — so the button goes back to offering a save.
  useEffect(() => {
    setSaved(false);
  }, [filters]);

  if (!enabled) return null;

  async function save() {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/client/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name: n, notify, filters }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Couldn't save that search.");
        return;
      }
      setSaved(true);
      setOpen(false);
      setName("");
    } catch {
      setError("Couldn't save that search.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="save-search" ref={wrapRef}>
      <button type="button" className="save-search-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {saved ? "✓ Search saved" : "Save this search"}
      </button>
      {open && (
        <div className="save-search-pop" role="dialog" aria-label="Save this search">
          <label className="save-search-label" htmlFor="save-search-name">
            Name this search
          </label>
          <input
            id="save-search-name"
            type="text"
            value={name}
            maxLength={60}
            placeholder="e.g. Paralegals, PH, under $12"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
          />
          <p className="save-search-note">
            {matchCount.toLocaleString()} {matchCount === 1 ? "person matches" : "people match"} right now. We&apos;ll
            tell you when that number grows.
          </p>
          <div className="save-search-freq" role="radiogroup" aria-label="Email me about new matches">
            {(["off", "daily", "weekly"] as const).map((v) => (
              <label key={v} className={notify === v ? "on" : undefined}>
                <input type="radio" name="notify" checked={notify === v} onChange={() => setNotify(v)} />
                {v === "off" ? "No email" : v === "daily" ? "Daily" : "Weekly"}
              </label>
            ))}
          </div>
          {error && <p className="save-search-err">{error}</p>}
          <div className="save-search-actions">
            <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={!name.trim() || busy}>
              {busy ? "Saving…" : "Save search"}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
