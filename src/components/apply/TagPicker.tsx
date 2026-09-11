"use client";

import { useMemo, useRef, useState } from "react";

/**
 * Type-to-add picker for skills and tools.
 *
 * The builder previously offered preset chips and nothing else, so a candidate
 * whose real skill was not in their role's taxonomy had no way to enter it —
 * and the free-text fallback only appeared for roles with NO taxonomy at all,
 * which is the one case where it was least likely to be needed. Tools had no
 * custom path whatever.
 *
 * WHY THE STORED STRING IS FUSSED OVER. candidates.skills feeds the client
 * browse facet list (skill_aggregation — there is no tool aggregation, so
 * tools are matched but never listed), and browse round-trips the chosen
 * filters through `join(",")` and `split(",")`. So two properties matter:
 *   * a comma inside a stored skill splits it into two filters, and
 *   * "HubSpot", "hubspot" and "Hub Spot" would list as three filters for one
 *     thing.
 * Hence commas are stripped and a typed value collapses onto an existing
 * spelling rather than creating a second one.
 */
/**
 * The comparison key, exported so the preset chip row and the tool tile grid
 * on step 3 dedupe exactly the way the picker does. Two definitions of "is
 * this the same skill" would drift, and the drift shows up as duplicate client
 * filters rather than as an error.
 */
export function tagKey(s: string): string {
  const key = s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return key || s.toLowerCase().trim();
}

export default function TagPicker({
  value,
  onChange,
  suggestions,
  max,
  noun,
  placeholder,
  showTray = true,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** Canonical presets. Typed input matching one of these adopts its casing. */
  suggestions: string[];
  max: number;
  /** "skill" / "tool" — used in the messages the candidate reads. */
  noun: string;
  placeholder: string;
  /**
   * Render the selected-tag tray. Off for tools, where the tile grid already
   * shows the selection — and where the tray would be actively wrong, because
   * its empty state is the stylesheet's hardcoded
   * `:empty::before { content: "Skills you add will appear here" }`, with no
   * tools variant to parameterise.
   */
  showTray?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  /** Display form: trimmed, inner whitespace collapsed. What gets stored. */
  const MAX_LEN = 60;
  const tidy = (s: string) =>
    s
      // Commas are removed rather than trimmed from the end only: browse joins
      // the chosen skill filters with "," and splits on it, so one comma
      // inside a stored skill becomes two bogus filters.
      .replace(/,/g, " ")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, MAX_LEN);
  /**
   * Comparison key: lowercased with spaces and punctuation removed.
   *
   * Case folding alone still let "hub spot" through next to "HubSpot", and the
   * facet list would then offer a client two filters for one tool. Comparing
   * on alphanumerics only collapses the spacing and hyphenation variants
   * people actually type — hubspot / Hub Spot / Hub-Spot — while the stored
   * string keeps whichever spelling is canonical.
   */
  // One definition, shared with step 3's preset paths. A value with no ASCII
  // alphanumerics — "中文", an em dash — would reduce to "" and collide with
  // every other such value, so tagKey falls back to the case-folded text.
  const norm = tagKey;
  const full = value.length >= max;

  const matches = useMemo(() => {
    const q = norm(query);
    if (!q) return [];
    const taken = new Set(value.map(norm));
    return suggestions.filter((s) => norm(s).includes(q) && !taken.has(norm(s))).slice(0, 8);
  }, [query, suggestions, value]);

  /** A suggestion whose name IS what was typed, ignoring case and spacing. */
  const exact = useMemo(() => {
    const q = norm(query);
    return q ? suggestions.find((sg) => norm(sg) === q) : undefined;
  }, [query, suggestions]);

  // matches shrinks as tags are added elsewhere on the step (the preset chips
  // and the tool tiles both write the same arrays), and a highlight left past
  // the end made Enter fall through to `?? query` and store the raw text.
  const safeHighlight = Math.min(highlight, Math.max(0, matches.length - 1));

  /** Add `raw`, collapsed onto an existing spelling where one exists. */
  function add(raw: string) {
    const cleaned = tidy(raw);
    if (!cleaned) return;

    if (full) {
      // Clear the box as well as explaining. Leaving the text in a disabled
      // input freezes it on screen with no way to remove it — the candidate
      // cannot edit a disabled field, and the value is never going to be added.
      setNotice(`That's the maximum of ${max} ${noun}s. Remove one to add another.`);
      setQuery("");
      return;
    }
    // Collapse onto whatever spelling already exists — a selected value first,
    // then a suggestion — so the facet list never carries the same thing twice.
    const existing = value.find((v) => norm(v) === norm(cleaned));
    if (existing) {
      setNotice(`${existing} is already on your list.`);
      setQuery("");
      return;
    }
    const canonical = suggestions.find((s) => norm(s) === norm(cleaned)) ?? cleaned;

    onChange([...value, canonical]);
    setQuery("");
    setHighlight(0);
    setNotice("");
  }

  function remove(tag: string) {
    onChange(value.filter((v) => v !== tag));
    setNotice("");
  }

  return (
    <div>
      {/* The tray. Its :empty rule prints the "will appear here" prompt, so it
          renders unconditionally rather than being hidden when nothing is
          selected. */}
      {showTray && (
      <div className="pb-skill-tags mb-3">
        {value.map((tag) => (
          <span key={tag} className="pb-skill-tag">
            {tag}
            <button
              type="button"
              className="skill-remove"
              aria-label={`Remove ${tag}`}
              onClick={() => remove(tag)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      )}

      <div className="pb-skill-input-wrap" style={{ display: "flex", gap: 8 }}>
        <svg className="pb-skill-search-icon" width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
          <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="pb-skill-search"
          placeholder={full ? `Maximum ${max} ${noun}s reached` : placeholder}
          value={query}
          disabled={full}
          autoComplete="off"
          enterKeyHint="done"
          aria-label={`Add a ${noun}`}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
            setNotice("");
          }}
          // Commit on blur, like TagInput and WorkEntryTagInput already do.
          // Without it, anything still in the box when the candidate taps
          // Continue — or a tool tile, or any other field — is silently
          // discarded while the text stays visibly on screen. Both siblings
          // carry a comment about Android keyboards advancing focus without
          // firing an Enter keydown; this component had copied only the
          // enterKeyHint half of their fix.
          onBlur={() => add(query)}
          onKeyDown={(e) => {
            // Enter must never reach the surrounding form. This sits inside
            // the builder's <form>, so without preventDefault the browser's
            // implicit submission would advance the step instead of adding
            // what was just typed.
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              // An exact match wins over the highlighted row. Typing "Zoom"
              // in full used to store "ZoomInfo", because matches is ordered
              // by the preset array and highlight resets to 0 — the candidate
              // typed the whole correct name and got a different tool.
              add(exact ?? matches[safeHighlight] ?? query);
              return;
            }
            if (e.key === "ArrowDown" && matches.length) {
              e.preventDefault();
              setHighlight(Math.min(matches.length - 1, safeHighlight + 1));
            } else if (e.key === "ArrowUp" && matches.length) {
              e.preventDefault();
              setHighlight(Math.max(0, safeHighlight - 1));
            } else if (e.key === "Backspace" && !query && value.length) {
              // Familiar from every tag field: backspace on an empty box takes
              // back the last thing you added. Name it, so a stray press on an
              // already-empty box is not a silent deletion.
              const last = value[value.length - 1];
              onChange(value.slice(0, -1));
              setNotice(`Removed ${last}. Type it again to put it back.`);
            }
          }}
        />
        <button
          type="button"
          className="pb-employer-add"
          style={{ flex: "0 0 auto", marginTop: 0 }}
          disabled={full || !query.trim()}
          // onMouseDown, not onClick: the input's onBlur fires first on a
          // click and would clear the query before the handler ever ran.
          onMouseDown={(e) => {
            e.preventDefault();
            add(query);
          }}
        >
          Add
        </button>
      </div>

      {matches.length > 0 && (
        <div className="pb-skill-suggestions mt-2">
          {matches.map((s, i) => (
            <button
              key={s}
              type="button"
              className={`pb-skill-suggestion ${i === safeHighlight ? "focused" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => {
                add(s);
                inputRef.current?.focus();
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Says what happened when a press did nothing visible — a duplicate
          collapsed, or the cap was hit. Without it both read as a dead key. */}
      {notice && (
        <p className="pb-section-help mt-2" role="status">
          {notice}
        </p>
      )}
      {!notice && query.trim() && matches.length === 0 && !full && (
        <p className="pb-section-help mt-2" role="status">
          Press Enter to add &ldquo;{query.trim()}&rdquo; as your own {noun}.
        </p>
      )}
    </div>
  );
}
