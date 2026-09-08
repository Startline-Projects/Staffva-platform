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
  searchable: boolean;
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
 * removes them, deleting a list deletes it, changing the email frequency
 * changes what the digest sends. Atlas's equivalents are all decorative.
 */
export default function ShortlistsView({
  shortlists,
  searches,
}: {
  shortlists: ShortlistWithPeople[];
  searches: SavedSearchRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

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
      setError("Couldn't delete that list.");
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

  const totalSaved = shortlists.reduce((n, l) => n + l.people.length, 0);

  return (
    <section className="sl">
      <h1 className="sl-title">My Shortlists</h1>
      <p className="sl-lead">
        {totalSaved === 0
          ? "Nothing saved yet. The heart on any browse card puts someone here."
          : `${totalSaved} ${totalSaved === 1 ? "person" : "people"} across ${shortlists.length} ${shortlists.length === 1 ? "list" : "lists"}.`}
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
              <h2>
                {l.name}
                {l.isDefault && <span className="sl-default" title="Where the heart saves by default">default</span>}
              </h2>
              <span className="sl-list-count">
                {l.people.length} {l.people.length === 1 ? "person" : "people"}
              </span>
              {/* The default list is not deletable: the heart writes to it,
                  and deleting it mid-session would make the next save create
                  a second one with the same name. */}
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
            </div>

            {l.people.length === 0 ? (
              <p className="sl-list-empty">Nothing in this list yet.</p>
            ) : (
              <div className="sl-people">
                {l.people.map((p) => (
                  <div key={p.id} className={`sl-person${p.searchable ? "" : " gone"}`}>
                    <div
                      className="sl-avatar"
                      style={p.photo ? { backgroundImage: `url(${p.photo})` } : undefined}
                      aria-hidden
                    >
                      {!p.photo && (p.name[0] || "?").toUpperCase()}
                    </div>
                    <div className="sl-person-main">
                      <div className="sl-person-name">{p.name}</div>
                      <div className="sl-person-role">{p.role}</div>
                      <div className="sl-person-meta">
                        {p.country}
                        {p.rate > 0 && <> · ${p.rate}/hr</>}
                        {p.tier && <> · English {p.tier}</>}
                      </div>
                      {p.searchable ? (
                        <div className="sl-person-avail">{p.availability}</div>
                      ) : (
                        // Saying nothing here would leave a client emailing
                        // someone the marketplace has already withdrawn.
                        <div className="sl-person-gone">
                          Not currently available on StaffVA
                        </div>
                      )}
                    </div>
                    <div className="sl-person-actions">
                      {p.searchable && (
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
          filters and tells you when more people match.
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
                      {s.newSince > 0 && <span className="sl-search-new">+{s.newSince} more since you looked</span>}
                    </>
                  )}
                </div>
              </div>
              <div className="sl-search-actions">
                <label className="sl-search-freq">
                  <span>Email</span>
                  <select
                    value={s.notify}
                    disabled={busy === s.id}
                    onChange={(e) => setNotify(s.id, e.target.value)}
                    aria-label={`Email frequency for ${s.name}`}
                  >
                    <option value="off">Never</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
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
