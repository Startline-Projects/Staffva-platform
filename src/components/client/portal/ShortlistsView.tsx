"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export interface ShortlistPerson {
  id: string;
  name: string;
  role: string;
  country: string;
  rate: number;
  photo: string | null;
  tier: string | null;
  availability: string;
  /**
   * Why this person is no longer listed, or null if they are. The server
   * blanks the directory fields above whenever this is set, so a withdrawn
   * candidate's photo and rate never reach the browser at all.
   */
  withdrawn: string | null;
}

export interface ShortlistWithPeople {
  id: string;
  name: string;
  isDefault: boolean;
  people: ShortlistPerson[];
}

export interface SavedSearchRow {
  id: string;
  name: string;
  summary: string;
  href: string;
  notify: "off" | "daily" | "weekly";
  count: number;
  newSince: number;
}

/**
 * The shortlists page body. Every control here writes: removing a person
 * removes them, renaming a list renames it, deleting one deletes it, and
 * changing the email frequency changes what the digest sends. Atlas's
 * equivalents are all decorative.
 *
 * Atlas controls deliberately NOT built here, so the omissions are on record
 * rather than merely absent:
 *  - Share by link (owner's D6 — candidate names and rates would leave the
 *    authenticated product).
 *  - Multi-select with "Move to…", "Message all", bulk Remove. Move needs a
 *    selection model this page does not have; "Message all" would open N
 *    conversations from one click, which is a decision per person, not one
 *    decision. Both are worth revisiting once there is a reason beyond
 *    matching the prototype.
 *  - Per-list sort. Ours is newest-saved first, which is the order a client
 *    building a list actually wants; a sort control over a list of six is
 *    furniture.
 *  - Editing a saved search's filters in place. /browse is where filters get
 *    built, and an edit form here would be a second, diverging copy of them
 *    — the same trap step 6's facets fell into. Save a new one and delete the
 *    old.
 *  - List descriptions and a "last updated" eyebrow: we store added_at and
 *    created_at and could show both, but neither changes a decision.
 */
export default function ShortlistsView({
  shortlists,
  searches,
  distinctSaved,
}: {
  shortlists: ShortlistWithPeople[];
  searches: SavedSearchRow[];
  distinctSaved: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  // Which list is being renamed, and to what. Without a rename a mistyped
  // name is permanent — there is nowhere else in the product to change one.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");

  async function post(body: unknown, path = "/api/client/shortlists") {
    setError("");
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || "That didn't work. Try again.");
      return false;
    }
    return true;
  }

  async function remove(shortlistId: string, candidateId: string) {
    setBusy(candidateId + shortlistId);
    const ok = await post({ action: "remove", shortlistId, candidateId });
    setBusy(null);
    if (ok) router.refresh();
  }

  async function deleteList(id: string) {
    setBusy(id);
    setError("");
    const res = await fetch(`/api/client/shortlists?id=${id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || "Couldn't delete that list.");
      return;
    }
    router.refresh();
  }

  async function createList() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    const ok = await post({ action: "create", name });
    setCreating(false);
    if (ok) {
      setNewName("");
      router.refresh();
    }
  }

  async function saveRename(id: string) {
    const name = renameTo.trim();
    if (!name) return;
    setBusy(id);
    const ok = await post({ action: "rename", id, name });
    setBusy(null);
    if (ok) {
      setRenaming(null);
      router.refresh();
    }
  }

  async function deleteSearch(id: string) {
    setBusy(id);
    setError("");
    const res = await fetch(`/api/client/saved-searches?id=${id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      setError("Couldn't delete that search.");
      return;
    }
    router.refresh();
  }

  async function setNotify(id: string, notify: string) {
    setBusy(id);
    await post({ action: "notify", id, notify }, "/api/client/saved-searches");
    setBusy(null);
    router.refresh();
  }

  // Opening a search is also "I have now seen this many" — the badge would
  // otherwise keep announcing the same arrivals every visit.
  function openSearch(s: SavedSearchRow) {
    if (s.newSince > 0) {
      fetch("/api/client/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seen", id: s.id }),
      }).catch(() => {});
    }
  }


  return (
    <section className="sl">
      <h1 className="sl-title">My Shortlists</h1>
      <p className="sl-lead">
        {distinctSaved === 0
          ? "Nothing saved yet. The heart on any browse card puts someone here."
          : `${distinctSaved} ${distinctSaved === 1 ? "person" : "people"} across ${shortlists.length} ${shortlists.length === 1 ? "list" : "lists"}. Someone can be on more than one.`}
      </p>

      {error && <p className="sl-error">{error}</p>}

      <div className="sl-newlist">
        <input
          type="text"
          value={newName}
          maxLength={60}
          placeholder="New list name"
          aria-label="New list name"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              createList();
            }
          }}
        />
        <button type="button" className="btn btn-outline" onClick={createList} disabled={!newName.trim() || creating}>
          {creating ? "Creating…" : "New list"}
        </button>
      </div>

      {shortlists.length === 0 ? (
        <div className="sl-empty">
          <p>You haven&apos;t saved anyone yet.</p>
          <Link href="/browse" className="btn btn-primary">
            Browse talent
          </Link>
        </div>
      ) : (
        shortlists.map((l) => (
          <div key={l.id} className="sl-list">
            <div className="sl-list-head">
              {renaming === l.id ? (
                <>
                  <input
                    className="sl-rename-input"
                    type="text"
                    value={renameTo}
                    maxLength={60}
                    autoFocus
                    aria-label={`Rename ${l.name}`}
                    onChange={(e) => setRenameTo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveRename(l.id);
                      }
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                  <button type="button" className="sl-list-del" onClick={() => saveRename(l.id)} disabled={busy === l.id || !renameTo.trim()}>
                    Save
                  </button>
                  <button type="button" className="sl-list-del" onClick={() => setRenaming(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <h2>
                    {l.name}
                    {l.isDefault && <span className="sl-default" title="Where the heart saves by default">default</span>}
                  </h2>
                  <span className="sl-list-count">
                    {l.people.length} {l.people.length === 1 ? "person" : "people"}
                  </span>
                  {/* The default list can be renamed like any other — its
                      identity is is_default, not its label — but it cannot be
                      deleted: the heart writes into it, and the API refuses
                      too, so this is not a UI-only rule. */}
                  <button
                    type="button"
                    className="sl-list-del"
                    onClick={() => {
                      setRenameTo(l.name);
                      setRenaming(l.id);
                    }}
                  >
                    Rename
                  </button>
                  {!l.isDefault && (
                    <button
                      type="button"
                      className="sl-list-del"
                      onClick={() => deleteList(l.id)}
                      disabled={busy === l.id}
                    >
                      {busy === l.id ? "Deleting…" : "Delete list"}
                    </button>
                  )}
                </>
              )}
            </div>

            {l.people.length === 0 ? (
              <p className="sl-list-empty">Nothing in this list yet.</p>
            ) : (
              <div className="sl-people">
                {l.people.map((p) => (
                  <div key={p.id} className={`sl-person${p.withdrawn ? " gone" : ""}`}>
                    <div
                      className="sl-avatar"
                      // Quoted and encoded: this is the one place on the page
                      // where a candidate-controlled string lands in a CSS
                      // value rather than a text node. Today profile_photo_url
                      // is an upload path, so it is not reachable — but the
                      // fix costs nothing and the assumption might not hold.
                      style={p.photo ? { backgroundImage: `url("${encodeURI(p.photo).replace(/"/g, "%22")}")` } : undefined}
                      aria-hidden
                    >
                      {!p.photo && (p.name[0] || "?").toUpperCase()}
                    </div>
                    <div className="sl-person-main">
                      <div className="sl-person-name">{p.name}</div>
                      {p.withdrawn ? (
                        // The specific reason, not one soft sentence covering
                        // a closed account, an unlisted profile and a
                        // temporary hide alike.
                        <div className="sl-person-gone">{p.withdrawn}</div>
                      ) : (
                        <>
                          <div className="sl-person-role">{p.role}</div>
                          <div className="sl-person-meta">
                            {p.country}
                            {p.rate > 0 && <> · ${p.rate}/hr</>}
                            {p.tier && <> · English {p.tier}</>}
                          </div>
                          <div className="sl-person-avail">{p.availability}</div>
                        </>
                      )}
                    </div>
                    <div className="sl-person-actions">
                      {!p.withdrawn && (
                        <Link href={`/candidate/${p.id}`} className="sl-person-view">
                          View
                        </Link>
                      )}
                      <button
                        type="button"
                        className="sl-person-remove"
                        onClick={() => remove(l.id, p.id)}
                        disabled={busy === p.id + l.id}
                        aria-label={`Remove ${p.name} from ${l.name}`}
                      >
                        {busy === p.id + l.id ? "…" : "Remove"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}

      <h2 className="sl-section">Saved searches</h2>
      {searches.length === 0 ? (
        <p className="sl-list-empty">
          None yet. &ldquo;Save this search&rdquo; on <Link href="/browse">Browse</Link> keeps a set of
          filters so you can come back to it — and, if you ask it to, emails you when more
          people match.
        </p>
      ) : (
        <div className="sl-searches">
          {searches.map((s) => (
            <div key={s.id} className="sl-search">
              <div className="sl-search-main">
                <Link href={s.href} className="sl-search-name" onClick={() => openSearch(s)}>
                  {s.name}
                </Link>
                <div className="sl-search-sum">{s.summary}</div>
                <div className="sl-search-count">
                  {s.count < 0 ? (
                    <span className="sl-search-unknown">Couldn&apos;t count right now</span>
                  ) : (
                    <>
                      {s.count.toLocaleString()} {s.count === 1 ? "match" : "matches"}
                      {/* A NET rise, not a set of arrivals: if five left and
                          eight joined this says +3, and it says nothing at all
                          when equal numbers move both ways. "more than when"
                          is the claim we can actually defend. */}
                      {s.newSince > 0 && (
                        <span className="sl-search-new">{s.newSince} more than when you last looked</span>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="sl-search-actions">
                <label className="sl-search-freq">
                  {/* "Email: Weekly" reads as a schedule; it is a ceiling —
                      at most one message, and only when the count has risen. */}
                  <span>Email at most</span>
                  <select
                    value={s.notify}
                    disabled={busy === s.id}
                    onChange={(e) => setNotify(s.id, e.target.value)}
                    aria-label={`Email frequency for ${s.name}`}
                  >
                    <option value="off">Never</option>
                    <option value="daily">Once a day</option>
                    <option value="weekly">Once a week</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="sl-person-remove"
                  onClick={() => deleteSearch(s.id)}
                  disabled={busy === s.id}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
