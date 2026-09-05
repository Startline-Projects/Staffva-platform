"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The Atlas notifications bell, backed by candidate_notifications (00202).
 *
 * Faithful to the prototype's behavior: badge with unread count, dropdown
 * with All/Unread filter pills, mark-all-read (disabled at zero), click marks
 * one read and routes, outside-click and Escape close. Counts are DERIVED
 * from the data — the prototype hard-coded "3" against four seeded unread
 * items, a bug its own spec flags.
 *
 * Routes come from the database but were written by our own server code and
 * the table CHECK-constrains them to app-relative paths; the guard here is
 * belt-and-braces against a poisoned row, not the primary defense.
 */

interface Notif {
  id: string;
  category: "offer" | "message" | "contract" | "review" | "profile" | "payout" | "interview" | "system";
  title: string;
  body: string | null;
  route: string | null;
  created_at: string;
  read_at: string | null;
}

const CAT_ICONS: Record<Notif["category"], React.ReactNode> = {
  offer: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1 9.5 5l4.5.5-3.3 3 .8 4.5L8 11l-3.5 2 .8-4.5-3.3-3L6.5 5 8 1Z" />
    </svg>
  ),
  message: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 3h10v7a1 1 0 0 1-1 1H6l-3 2.5V3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
  contract: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 1.5h6L11 4v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="m5 8 1.5 1.5L9.5 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  review: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 1.5 8.6 5l3.9.4-2.9 2.7.8 3.9L7 10l-3.4 2 .8-3.9L1.5 5.4 5.4 5 7 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ),
  profile: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="5" r="2.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 12.5c.4-2.4 2.3-3.6 4.5-3.6s4.1 1.2 4.5 3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  payout: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 2v10M4.2 4.8h4a1.6 1.6 0 0 1 0 3.2h-2.4a1.6 1.6 0 0 0 0 3.2h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  interview: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="3" width="8" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="m9.5 6.5 3-2v5l-3-2" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
  system: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7 4.5V7l1.8 1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
};

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function NotifBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef<HTMLSpanElement>(null);

  async function load() {
    try {
      const res = await fetch("/api/candidate/notifications");
      if (!res.ok) return;
      const j = await res.json();
      setItems(j.notifications || []);
      setUnread(j.unread || 0);
    } catch {
      /* the bell simply shows its last state */
    }
  }

  // Load once on mount (deferred a tick — the purity lint rightly refuses
  // synchronous setState-reachable calls in an effect body), then a slow
  // poll: notifications are minutes-scale events, not seconds.
  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  // Outside click + Escape close, per the prototype.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markRead(ids: string[] | null) {
    // Optimistic — the server is authoritative on next load.
    setItems((prev) =>
      prev.map((n) =>
        ids === null || ids.includes(n.id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n
      )
    );
    setUnread((u) => (ids === null ? 0 : Math.max(0, u - ids.length)));
    try {
      await fetch("/api/candidate/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids === null ? {} : { ids }),
      });
    } catch {
      /* reconciled by the next poll */
    }
  }

  function onItemClick(n: Notif) {
    if (!n.read_at) markRead([n.id]);
    setOpen(false);
    // App-relative only. WHATWG URL parsing treats a backslash as a slash in
    // special schemes, so '/\evil.com' resolves cross-origin — the DB CHECK
    // (00204) rejects it at write time and this guard rejects it at click
    // time, because a stored row outlives whichever layer was fixed last.
    if (
      n.route &&
      n.route.startsWith("/") &&
      !n.route.startsWith("//") &&
      !n.route.includes("\\")
    ) {
      router.push(n.route);
    }
  }

  const shown = filter === "unread" ? items.filter((n) => !n.read_at) : items;

  return (
    <span className="topbar-bell-wrap" ref={wrapRef}>
      <button
        className="topbar-bell"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        type="button"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M9 2a5 5 0 0 0-5 5v3l-1.5 2.5h13L14 10V7a5 5 0 0 0-5-5ZM7 15a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="topbar-bell-badge" data-count={unread > 99 ? "99+" : String(unread)}>
          {unread > 99 ? "99+" : unread}
        </span>
      </button>

      <div className={`notif-dropdown${open ? " visible" : ""}`} role="menu" aria-label="Notifications">
        <header className="notif-dropdown-header">
          <h3>Notifications</h3>
          <button
            type="button"
            className="notif-dropdown-mark"
            disabled={unread === 0}
            onClick={() => markRead(null)}
          >
            Mark all read
          </button>
        </header>
        <div className="notif-dropdown-filters" role="tablist">
          <button
            type="button"
            className={`notif-filter-pill${filter === "all" ? " active" : ""}`}
            role="tab"
            aria-selected={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All <span className="count">{items.length}</span>
          </button>
          <button
            type="button"
            className={`notif-filter-pill${filter === "unread" ? " active" : ""}`}
            role="tab"
            aria-selected={filter === "unread"}
            onClick={() => setFilter("unread")}
          >
            Unread <span className="count">{unread}</span>
          </button>
        </div>
        <div className="notif-list">
          {shown.length === 0 ? (
            <p style={{ padding: "22px 18px", fontSize: 13, color: "var(--ink-mute)" }}>
              {filter === "unread"
                ? "You're all caught up."
                : "Nothing yet. When something happens — a message, an offer, a contract — it lands here."}
            </p>
          ) : (
            shown.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`notif-item${n.read_at ? "" : " unread"}`}
                onClick={() => onItemClick(n)}
              >
                <span className={`notif-icon cat-${n.category}`} aria-hidden="true">
                  {CAT_ICONS[n.category]}
                </span>
                <div className="notif-body">
                  <div className="notif-title">{n.title}</div>
                  {n.body && <div className="notif-text">{n.body}</div>}
                  <div className="notif-time">{timeAgo(n.created_at)}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </span>
  );
}
