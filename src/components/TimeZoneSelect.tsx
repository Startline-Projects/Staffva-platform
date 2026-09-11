"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * A searchable time-zone picker.
 *
 * This field used to be a free-text input, pre-filled from
 * Intl.DateTimeFormat().resolvedOptions().timeZone and styled grey so it read
 * as disabled — so a candidate whose browser reported the wrong zone, or who
 * cleared the box, had no way to choose the right one and no hint that typing
 * was even allowed. Whatever they left behind was written to
 * candidates.time_zone verbatim, which is the value clients see and the
 * booking calendar warns against when a slot lands outside working hours. A
 * typo there misroutes interview scheduling.
 *
 * The list comes from the runtime (Intl.supportedValuesOf), not a hardcoded
 * table, so it cannot drift as the IANA database changes — 418 zones today.
 * Each is shown with its CURRENT offset, because "Asia/Riyadh" means nothing
 * to most people and "GMT+3" does.
 *
 * Offsets are computed per render pass rather than stored: they move with
 * daylight saving, and a cached "GMT+1" is wrong for half the year.
 *
 * It reuses the .country-* classes. They are named for their first use, not
 * their meaning — the underlying pattern is a generic searchable dropdown, and
 * borrowing it keeps this visually identical to the country picker beside it
 * without inventing a parallel set of rules that could drift from it.
 */

/** A small, ordered fallback for browsers without Intl.supportedValuesOf
 *  (pre-2022 Safari and Firefox). Covers the markets StaffVA actually
 *  recruits in, so nobody is left with an empty menu. */
const FALLBACK_ZONES = [
  "Asia/Manila", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Jakarta",
  "Africa/Cairo", "Africa/Lagos", "Africa/Nairobi", "Africa/Johannesburg",
  "Asia/Riyadh", "Asia/Dubai", "Asia/Amman", "Asia/Beirut", "Asia/Baghdad",
  "Europe/London", "Europe/Berlin", "Europe/Madrid", "Europe/Warsaw",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Bogota", "America/Mexico_City", "America/Sao_Paulo", "America/Buenos_Aires",
  "Australia/Sydney", "Pacific/Auckland", "UTC",
];

/**
 * Search aliases for zones the IANA database has RENAMED.
 *
 * Runtimes return the old canonical id, so an Indian candidate — one of the
 * five markets StaffVA recruits in — types "Kolkata", the name their country
 * has used since 2001, and the list comes back empty. They would have to guess
 * "Calcutta". Verified against this runtime: supportedValuesOf returns
 * Asia/Calcutta and no Asia/Kolkata.
 *
 * Aliases are searched, never displayed: the stored value stays the canonical
 * id the runtime gave us, so nothing downstream has to know about this.
 */
const ALIASES: Record<string, string[]> = {
  "Asia/Calcutta": ["Kolkata", "India", "IST"],
  "Asia/Kolkata": ["Calcutta", "India", "IST"],
  "Asia/Dacca": ["Dhaka", "Bangladesh"],
  "Asia/Dhaka": ["Dacca", "Bangladesh"],
  "Asia/Saigon": ["Ho Chi Minh", "Vietnam"],
  "Asia/Ho_Chi_Minh": ["Saigon", "Vietnam"],
  "Asia/Rangoon": ["Yangon", "Myanmar"],
  "Asia/Yangon": ["Rangoon", "Myanmar"],
  "Asia/Katmandu": ["Kathmandu", "Nepal"],
  "Asia/Kathmandu": ["Katmandu", "Nepal"],
  "Europe/Kiev": ["Kyiv", "Ukraine"],
  "Europe/Kyiv": ["Kiev", "Ukraine"],
  "Asia/Manila": ["Philippines", "PHT"],
  "Africa/Cairo": ["Egypt"],
  "Africa/Lagos": ["Nigeria"],
  "Asia/Karachi": ["Pakistan"],
  "Asia/Riyadh": ["Saudi Arabia", "KSA"],
  "Asia/Aden": ["Yemen"],
  "UTC": ["GMT", "Coordinated Universal Time"],
};

function allZones(): string[] {
  let zones: string[] = FALLBACK_ZONES;
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.("timeZone");
    if (supported && supported.length) zones = supported;
  } catch {
    /* keep the fallback */
  }
  // UTC is what this form STORES when nothing is chosen (see the || "UTC" in
  // ApplicationForm), but supportedValuesOf does not return it on every
  // runtime — verified absent here. A fallback value you cannot select back is
  // a trap: the candidate sees "UTC" in the field and cannot find it again.
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

/** "GMT+3" for a zone, right now. Returns "" when the runtime rejects it. */
function offsetOf(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** "Asia/Riyadh" -> "Riyadh" — the part a person recognises. */
function cityOf(tz: string): string {
  return tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
}

export default function TimeZoneSelect({
  value,
  onChange,
  id = "timeZoneTrigger",
  label = "Time zone",
}: {
  value: string;
  onChange: (tz: string) => void;
  id?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Read the zone list once on the CLIENT. Intl.supportedValuesOf returns a
  // different list on the server than in the user's browser, and computing it
  // during render would hydrate mismatched markup.
  const [zones, setZones] = useState<string[]>([]);
  useEffect(() => setZones(allZones()), []);

  const rows = useMemo(
    () =>
      zones.map((tz) => {
        const offset = offsetOf(tz);
        const city = cityOf(tz);
        return {
          tz,
          offset,
          city,
          // One lowercased haystack per row, aliases folded in, so a search is
          // a single includes() rather than four.
          haystack: [tz, city, offset, ...(ALIASES[tz] ?? [])].join(" ").toLowerCase(),
        };
      }),
    [zones]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    // Ranked, not just filtered. Plain substring matching put
    // America/Indiana/Knox above Asia/Calcutta for the query "india", because
    // "Indiana" contains "india" — so a candidate in one of the five markets
    // this product recruits from saw eight American zones before their own
    // (measured: Asia/Calcutta sat at index 8 behind the America/Indiana/*
    // family and America/Indianapolis).
    //
    // Score: an exact alias or city hit first, then a word that STARTS with
    // the query, then anything else. Ties keep the runtime's ordering.
    const score = (r: (typeof rows)[number]): number => {
      const city = r.city.toLowerCase();
      const aliases = (ALIASES[r.tz] ?? []).map((a) => a.toLowerCase());
      if (city === q || aliases.includes(q)) return 0;
      if (aliases.some((a) => a.startsWith(q))) return 1;
      if (city.startsWith(q)) return 2;
      if (r.offset.toLowerCase() === q) return 3;
      return 4;
    };
    return rows
      .filter((r) => r.haystack.includes(q))
      .map((r) => ({ r, s: score(r) }))
      .sort((a, b) => a.s - b.s)
      .map((x) => x.r);
  }, [rows, query]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  const selectedOffset = value ? offsetOf(value) : "";

  return (
    <div
      className={`country-wrap ${open ? "open" : ""}`}
      ref={wrapRef}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          (document.getElementById(id) as HTMLButtonElement | null)?.focus();
        }
      }}
    >
      <button
        type="button"
        className={`country-trigger ${value ? "" : "empty"}`}
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setQuery("");
          setHighlight(0);
        }}
      >
        <span className="country-name">
          {value ? `${cityOf(value)}${selectedOffset ? ` · ${selectedOffset}` : ""}` : "Select your time zone…"}
        </span>
      </button>

      {open && (
        <div className="country-menu" role="listbox" aria-label={label}>
          <div className="country-search-wrap">
            <input
              type="text"
              className="country-search"
              placeholder="Search a city or offset…"
              autoComplete="off"
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={(e) => {
                // ENTER MUST BE INTERCEPTED. This input sits inside the
                // application form, so without preventDefault the browser's
                // implicit submission fires handleStage3 — which writes
                // application_stage: 3, and apply/page.tsx only renders the
                // form while that is below 3. A candidate who typed a query
                // and hit Enter instead of clicking would be carried out of
                // the form with the device-guessed zone locked in, which is
                // the exact correction this component exists to allow.
                if (e.key === "Enter") {
                  e.preventDefault();
                  const pick = filtered[highlight];
                  if (pick) {
                    onChange(pick.tz);
                    setOpen(false);
                  }
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlight((h) => Math.min(filtered.length - 1, h + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlight((h) => Math.max(0, h - 1));
                } else if (e.key === "Home") {
                  e.preventDefault();
                  setHighlight(0);
                } else if (e.key === "End") {
                  e.preventDefault();
                  setHighlight(filtered.length - 1);
                }
              }}
            />
          </div>
          <div className="country-list" role="presentation" ref={listRef}>
            {filtered.map((r, i) => (
              <button
                key={r.tz}
                type="button"
                // .focused is the highlight hook atlas-auth.css already
                // defines and SearchableRoleSelect already drives.
                ref={(el) => {
                  if (i === highlight && el) el.scrollIntoView({ block: "nearest" });
                }}
                className={`country-option ${r.tz === value ? "selected" : ""} ${i === highlight ? "focused" : ""}`}
                role="option"
                aria-selected={r.tz === value}
                onClick={() => {
                  onChange(r.tz);
                  setOpen(false);
                }}
              >
                <span>{r.city}</span>
                <span className="country-code">{r.offset}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="no-results">No time zones match &ldquo;{query}&rdquo;</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
