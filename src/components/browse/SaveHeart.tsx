"use client";

import { useEffect, useRef, useState } from "react";
import { useShortlists } from "@/components/client/ShortlistsProvider";

/**
 * The heart on a result card, and the "save to which list" menu behind it.
 *
 * Renders nothing at all for anyone who is not a signed-in client — the save
 * needs a `clients` row, so for a candidate browsing the same page the
 * control could only fail.
 *
 * Clicking the heart saves to the default list. The caret opens the menu of
 * named lists with a checkbox each, plus a field to make a new one. Atlas
 * shows the same menu but its checkboxes write nothing; these do.
 */
export default function SaveHeart({
  candidateId,
  candidateName,
}: {
  candidateId: string;
  candidateName: string;
}) {
  const { enabled, ready, loadFailed, lists, listsFor, toggle, setMembership, createList, error, clearError } =
    useShortlists();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [menuError, setMenuError] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape — a menu pinned inside a card that
  // is itself a button will otherwise stay open behind the next preview.
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

  // loadFailed matters as much as !ready: with an empty members map the heart
  // would render unfilled for people who ARE saved, and the menu would tell a
  // client with four lists that they have none. Absent beats confidently wrong.
  if (!enabled || !ready || loadFailed) return null;

  const inLists = listsFor(candidateId);
  const saved = inLists.length > 0;

  async function onCreate() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setMenuError("");
    const res = await createList(name);
    if (!res.ok || !res.id) {
      setCreating(false);
      setMenuError(res.error || "Couldn't create that list.");
      return;
    }
    // Creating a list from inside a dialog headed "Save <name> to a list"
    // means "and put them in it". The first draft only created the list, so
    // the new row appeared with its checkbox unchecked — a click that looked
    // like it had done nothing.
    await setMembership(candidateId, res.id, true);
    setCreating(false);
    setNewName("");
  }

  return (
    <div
      className="result-save"
      ref={wrapRef}
      // The card is a role="button" that opens the preview panel; without
      // this every save would also open a panel over the menu.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`result-save-heart${saved ? " on" : ""}${error ? " failed" : ""}`}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${candidateName} from your lists` : `Save ${candidateName}`}
        // A save that failed while the menu was shut would otherwise just
        // un-fill the heart with no explanation anywhere on the page.
        title={
          error
            ? error
            : saved
              ? `Saved in ${inLists.length === 1 ? "1 list" : `${inLists.length} lists`}`
              : "Save to your shortlist"
        }
        onClick={() => {
          clearError();
          toggle(candidateId);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.7-7.7 1.1-1.1a5.5 5.5 0 0 0 0-7.8z" />
        </svg>
      </button>
      <button
        type="button"
        className="result-save-more"
        aria-label={`Choose which list to save ${candidateName} to`}
        aria-expanded={open}
        onClick={() => {
          setMenuError("");
          clearError();
          setOpen((v) => !v);
        }}
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="result-save-menu" role="dialog" aria-label={`Save ${candidateName} to a list`}>
          <div className="result-save-menu-head">Save to</div>
          {lists.length === 0 && (
            <p className="result-save-menu-empty">You don&apos;t have any lists yet. Make one below.</p>
          )}
          {lists.map((l) => (
            <label key={l.id} className="result-save-menu-row">
              <input
                type="checkbox"
                checked={inLists.includes(l.id)}
                onChange={(e) => setMembership(candidateId, l.id, e.target.checked)}
              />
              <span className="result-save-menu-name">{l.name}</span>
              <span className="result-save-menu-count">{l.count}</span>
            </label>
          ))}
          <div className="result-save-menu-new">
            <input
              type="text"
              value={newName}
              maxLength={60}
              placeholder="New list name"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onCreate();
                }
              }}
            />
            <button type="button" onClick={onCreate} disabled={!newName.trim() || creating}>
              {creating ? "…" : "Add"}
            </button>
          </div>
          {(menuError || error) && <p className="result-save-menu-err">{menuError || error}</p>}
        </div>
      )}
    </div>
  );
}
