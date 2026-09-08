"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Row {
  id: string;
  name: string;
  isDefault: boolean;
  count: number;
  contains?: boolean;
}

/**
 * "Save" in the profile's sticky action bar.
 *
 * Self-contained rather than driven by ShortlistsProvider: one profile means
 * one candidate, so there is no fan-out of identical requests to avoid, and
 * the profile page is a server component that would otherwise need a client
 * wrapper around its whole tree.
 *
 * The parent only renders this for a signed-in client viewing an approved
 * profile that is not their own, which is the same condition the rest of the
 * bar is under.
 */
export default function ProfileSaveButton({
  candidateId,
  candidateName,
}: {
  candidateId: string;
  candidateName: string;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/client/shortlists?candidateId=${candidateId}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setRows(data.shortlists || []);
    } catch {
      // null keeps the control out of the bar entirely — better than a Save
      // button that cannot say whether they are already saved.
      setRows(null);
    }
  }, [candidateId]);

  useEffect(() => {
    load();
  }, [load]);

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

  if (rows === null) return null;

  const saved = rows.some((r) => r.contains);

  async function post(body: unknown) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/client/shortlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "That didn't save.");
        return false;
      }
      return true;
    } catch {
      setError("That didn't save.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function quickSave() {
    if (saved) {
      setOpen(true);
      return;
    }
    if (await post({ action: "add", candidateId })) await load();
  }

  async function toggleList(listId: string, on: boolean) {
    if (await post({ action: on ? "add" : "remove", candidateId, shortlistId: listId })) await load();
  }

  async function createAndAdd() {
    const name = newName.trim();
    if (!name) return;
    const res = await fetch("/api/client/shortlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || "Couldn't create that list.");
      return;
    }
    setNewName("");
    // Creating a list from this button means "put them in it" — an empty new
    // list would be a click that appeared to do nothing.
    if (await post({ action: "add", candidateId, shortlistId: data.shortlist.id })) await load();
  }

  return (
    <div className="profile-save" ref={wrapRef}>
      <button
        type="button"
        className={`btn btn-outline sticky-secondary${saved ? " profile-save-on" : ""}`}
        onClick={quickSave}
        disabled={busy}
        aria-label={saved ? `${candidateName} is saved — choose lists` : `Save ${candidateName}`}
      >
        {saved ? "♥ Saved" : "♡ Save"}
      </button>
      <button
        type="button"
        className="btn btn-outline sticky-secondary profile-save-caret"
        aria-expanded={open}
        aria-label="Choose which list"
        onClick={() => setOpen((v) => !v)}
      >
        ▾
      </button>
      {open && (
        <div className="profile-save-menu" role="dialog" aria-label={`Save ${candidateName} to a list`}>
          <div className="result-save-menu-head">Save to</div>
          {rows.length === 0 && <p className="result-save-menu-empty">No lists yet. Make one below.</p>}
          {rows.map((r) => (
            <label key={r.id} className="result-save-menu-row">
              <input
                type="checkbox"
                checked={!!r.contains}
                disabled={busy}
                onChange={(e) => toggleList(r.id, e.target.checked)}
              />
              <span className="result-save-menu-name">{r.name}</span>
              <span className="result-save-menu-count">{r.count}</span>
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
                  createAndAdd();
                }
              }}
            />
            <button type="button" onClick={createAndAdd} disabled={!newName.trim() || busy}>
              Add
            </button>
          </div>
          {error && <p className="result-save-menu-err">{error}</p>}
        </div>
      )}
    </div>
  );
}
