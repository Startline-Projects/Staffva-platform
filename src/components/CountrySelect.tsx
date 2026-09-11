"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES } from "@/lib/atlasCountries";

/**
 * The searchable country picker, in one place.
 *
 * The signup page had this; the application form had a bare <select>. With 207
 * countries in the list that is the difference between typing three letters
 * and scrolling a native dropdown past Afghanistan, Albania, Algeria… to reach
 * Saudi Arabia. The picker existed a hundred lines away and was simply never
 * reused.
 *
 * Two callers store the value differently — signup keeps the ISO code, the
 * application form keeps the NAME, because that is what candidates.country has
 * always held and what api/ensure-profile validates against. So `by` selects
 * which one travels, rather than forcing one of them to convert at every read.
 */
export default function CountrySelect({
  value,
  onChange,
  by = "code",
  id = "countryTrigger",
  label = "Country of residence",
  placeholder = "Select country…",
}: {
  value: string;
  onChange: (value: string) => void;
  /** Which field the value represents: the ISO code, or the display name. */
  by?: "code" | "name";
  id?: string;
  label?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = COUNTRIES.find((c) => (by === "code" ? c.code : c.name) === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    // Name match OR exact code, so "SA" finds Saudi Arabia without also
    // returning every country with "sa" somewhere in its name.
    return COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q
    );
  }, [query]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

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
        className={`country-trigger ${selected ? "" : "empty"}`}
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setQuery("");
          setHighlight(0);
        }}
      >
        <span className="flag" aria-hidden>{selected?.flag || "🌍"}</span>
        <span className="country-name">{selected?.name || placeholder}</span>
      </button>

      {open && (
        <div className="country-menu" role="listbox" aria-label={label}>
          <div className="country-search-wrap">
            <input
              type="text"
              className="country-search"
              placeholder="Search countries…"
              autoComplete="off"
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={(e) => {
                // Enter must not reach the form. This input lives inside both
                // the signup form and the application form, and implicit
                // submission would submit the step instead of choosing the
                // country the candidate just searched for.
                if (e.key === "Enter") {
                  e.preventDefault();
                  const pick = filtered[highlight];
                  if (pick) {
                    onChange(by === "code" ? pick.code : pick.name);
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
          <div className="country-list" role="presentation">
            {filtered.map((c, i) => {
              const v = by === "code" ? c.code : c.name;
              return (
                <button
                  key={c.code}
                  type="button"
                  ref={(el) => {
                    if (i === highlight && el) el.scrollIntoView({ block: "nearest" });
                  }}
                  className={`country-option ${v === value ? "selected" : ""} ${i === highlight ? "focused" : ""}`}
                  role="option"
                  aria-selected={v === value}
                  onClick={() => {
                    onChange(v);
                    setOpen(false);
                  }}
                >
                  <span className="flag" aria-hidden>{c.flag}</span>
                  <span>{c.name}</span>
                  <span className="country-code">{c.code}</span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="no-results">No countries match &ldquo;{query}&rdquo;</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
