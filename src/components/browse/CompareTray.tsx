"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

/**
 * Compare, Atlas step 6 — the tray and the modal.
 *
 * The prototype compares seven rows: rate, star rating, "would hire again",
 * a 4-bar profile-strength meter, availability, top skills, video intro. Four
 * of those have nothing behind them here — nobody has a rehire percentage, a
 * star rating is only real for candidates who have actually been reviewed,
 * and "profile strength N/4" is a rendering of a number the prototype
 * invents. This compares what the row actually holds, and says "—" where a
 * candidate has not filled something in rather than scoring them for it.
 *
 * Its footer claim goes too. Atlas states "Differences are highlighted —
 * rate, rating, and would-hire-again all vary across these candidates",
 * which is asserted whether or not they do.
 */

export interface CompareCandidate {
  id: string;
  display_name: string;
  country: string | null;
  role_category: string | null;
  hourly_rate: number | null;
  english_written_tier: string | null;
  availability_status: string | null;
  availability_date?: string | null;
  us_client_experience: string | null;
  skills?: string[] | null;
  video_intro_status?: string | null;
  is_assessed?: boolean;
}

export const COMPARE_MAX = 4;

function availabilityLabel(c: CompareCandidate): string {
  if (c.availability_status === "available_now") return "Available now";
  if (c.availability_status === "available_by_date") {
    return c.availability_date
      ? `From ${new Date(c.availability_date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}`
      : "From a future date";
  }
  // NOT a dash: the footer tells the reader a dash means "not filled in",
  // and this person filled it in — the answer is no. Six of the current pool
  // are in exactly this state, and reading it as "unstated" costs the client
  // a message and a wait.
  if (c.availability_status === "not_available") return "Not available";
  return "—";
}

function usExperienceLabel(v: string | null): string {
  if (!v) return "—";
  const map: Record<string, string> = {
    none: "None",
    international_only: "International only",
    less_than_6_months: "Under 6 months",
    "6_months_to_1_year": "6–12 months",
    "1_to_2_years": "1–2 years",
    "2_to_5_years": "2–5 years",
    "5_plus_years": "5+ years",
  };
  return map[v] ?? "—";
}

const ROWS: { label: string; value: (c: CompareCandidate) => string }[] = [
  { label: "Rate", value: (c) => (c.hourly_rate != null ? `$${c.hourly_rate}/hr` : "—") },
  { label: "Role", value: (c) => c.role_category || "—" },
  { label: "Country", value: (c) => c.country || "—" },
  { label: "Availability", value: availabilityLabel },
  // The "—" rule from the relist stands: a tier renders only where an
  // assessment actually produced one.
  { label: "Written English", value: (c) => c.english_written_tier || "—" },
  { label: "US client experience", value: (c) => usExperienceLabel(c.us_client_experience) },
  {
    label: "Skills interview",
    // "Passed" is the only thing this column knows. is_assessed is derived
    // from candidates.ai_interview_passed, which collapses "never attempted"
    // and "attempted, did not pass" into the same falsy value — so saying
    // "not taken yet" would assert a history the data cannot support, about
    // the one fact a client is most likely to act on.
    value: (c) => (c.is_assessed ? "Passed" : "No pass on record"),
  },
  {
    label: "Video intro",
    value: (c) => (c.video_intro_status === "approved" ? "Yes" : "Not yet"),
  },
  {
    label: "Top skills",
    value: (c) => (c.skills && c.skills.length > 0 ? c.skills.slice(0, 4).join(" · ") : "—"),
  },
];

export default function CompareTray({
  selected,
  onRemove,
  onClear,
  open,
  onOpen,
  onClose,
}: {
  selected: CompareCandidate[];
  onRemove: (id: string) => void;
  onClear: () => void;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Escape closes, like every other modal here — plus the focus handling a
  // dialog owes a keyboard user: move focus in, keep Tab inside, put it back
  // where it came from. Declaring aria-modal without any of that leaves
  // someone tabbing through the results list behind the backdrop.
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const shell = shellRef.current;
    const focusables = () =>
      Array.from(
        shell?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((el) => el.offsetParent !== null);
    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      returnFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (selected.length === 0) return null;

  return (
    <>
      {/* .visible is what slides the existing bar up from off-screen. */}
      <div className="compare-bar visible" role="region" aria-label="Compare candidates">
        <span className="compare-bar-count">
          {selected.length} of {COMPARE_MAX} selected
        </span>
        <div className="compare-bar-names">
          {selected.map((c) => (
            <button
              key={c.id}
              type="button"
              className="compare-bar-chip"
              onClick={() => onRemove(c.id)}
              aria-label={`Remove ${c.display_name} from comparison`}
            >
              {c.display_name} <span aria-hidden>×</span>
            </button>
          ))}
        </div>
        <button type="button" className="compare-bar-btn outline" onClick={onClear}>
          Clear
        </button>
        <button
          type="button"
          className="compare-bar-btn"
          onClick={onOpen}
          disabled={selected.length < 2}
          title={selected.length < 2 ? "Pick at least two to compare" : undefined}
        >
          Compare
        </button>
      </div>

      {open && (
        <div className="compare-modal visible" role="dialog" aria-modal="true" aria-label="Compare candidates">
          <div className="compare-backdrop" onClick={onClose} />
          <div className="compare-shell" ref={shellRef}>
            <header className="compare-modal-head">
              <h2>Compare candidates</h2>
              <button type="button" className="compare-close" onClick={onClose} aria-label="Close">
                ×
              </button>
            </header>
            <div className="compare-table-wrap">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only-label">Field</span>
                    </th>
                    {selected.map((c) => (
                      <th scope="col" key={c.id}>
                        <span className="compare-col-name">{c.display_name}</span>
                        <button
                          type="button"
                          className="compare-col-remove"
                          onClick={() => onRemove(c.id)}
                          aria-label={`Remove ${c.display_name}`}
                        >
                          ×
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      {selected.map((c) => (
                        <td key={c.id}>{row.value(c)}</td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">Profile</th>
                    {selected.map((c) => (
                      <td key={c.id}>
                        <Link href={`/candidate/${c.id}`} className="compare-view-link">
                          View profile →
                        </Link>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="compare-foot">
              A dash means the candidate hasn&apos;t filled that in — not that the answer is no.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
