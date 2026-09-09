"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ADMIN_NAV,
  ADMIN_NAV_TOP,
  isRowActive,
  type AdminBadges,
  type AdminNavGroup,
  type AdminNavRow,
} from "./adminNav";
import { useAdminDrawer } from "./AdminDrawer";
import { getServerSnapshot, getSnapshot, subscribe, toggleGroup } from "./adminNavCollapse";

export default function AdminRail({
  isRecruitingManager,
  userName,
  userEmail,
}: {
  isRecruitingManager: boolean;
  userName: string;
  userEmail: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const { open, close } = useAdminDrawer();

  /**
   * `null` means "we do not know the counts", which is not the same as zero.
   * The command-center endpoint answers 403 to recruiting managers on purpose
   * — it carries client revenue — so for them the fetch never succeeds, and a
   * rail full of confident `0`s would be a lie about empty queues.
   */
  const [badges, setBadges] = useState<AdminBadges | null>(null);

  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [filter, setFilter] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/command-center")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.badges) setBadges(d.badges as AdminBadges); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // "/" jumps to the filter, but only when the user is not already typing
  // somewhere — otherwise it eats the slash out of a search box or a note.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const q = filter.trim().toLowerCase();

  const groups: AdminNavGroup[] = useMemo(() => {
    return ADMIN_NAV
      .map((g) => ({
        ...g,
        rows: g.rows.filter(
          (r) => (!isRecruitingManager || !r.adminOnly) && (!q || r.label.toLowerCase().includes(q))
        ),
      }))
      .filter((g) => g.rows.length > 0);
  }, [isRecruitingManager, q]);

  const showTop =
    (!isRecruitingManager || !ADMIN_NAV_TOP.adminOnly) &&
    (!q || ADMIN_NAV_TOP.label.toLowerCase().includes(q));

  const nothingMatches = Boolean(q) && !showTop && groups.length === 0;

  return (
    <>
      <aside className={`dash-sidebar${open ? " open" : ""}`} id="adminRail">
        <div className="admin-sidebar-header">
          <span className="admin-logo">
            StaffVA
            <span className="admin-logo-suffix">Admin</span>
          </span>
          <button type="button" className="admin-sidebar-close" onClick={close} aria-label="Close navigation">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="admin-sidebar-search">
          <div className="admin-search-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7.5" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              className="admin-search-input"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setFilter(""); }}
              placeholder="Filter navigation…"
              aria-label="Filter navigation"
            />
            <span className="admin-search-kbd" aria-hidden="true">/</span>
          </div>
        </div>

        <nav className="dash-nav" aria-label="Admin sections">
          {showTop && (
            <NavRow row={ADMIN_NAV_TOP} pathname={pathname} search={search} badges={badges} />
          )}

          {groups.map((g) => {
            // A filter that matches inside a collapsed group has to open it,
            // or the rail answers a search with a group header and nothing else.
            const isCollapsed = !q && collapsed.includes(g.id);
            return (
              <div key={g.id} className={`admin-nav-group${isCollapsed ? " collapsed" : ""}`}>
                <button
                  type="button"
                  className="admin-nav-group-label"
                  onClick={() => toggleGroup(g.id)}
                  aria-expanded={!isCollapsed}
                >
                  {g.label}
                  <svg className="admin-group-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                <ul className="admin-nav-list">
                  {g.rows.map((row) => (
                    <li key={row.label}>
                      <NavRow row={row} pathname={pathname} search={search} badges={badges} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          {nothingMatches && (
            <p className="admin-search-empty">
              Nothing in the rail matches “{filter.trim()}”.
            </p>
          )}
        </nav>

        <div className="dash-sidebar-footer">
          <span className="avatar-mini" aria-hidden="true">{initials(userName, userEmail)}</span>
          <span className="admin-user-meta">
            <span className="user-name">{userName}</span>
            <span className="admin-user-role">
              {isRecruitingManager ? "Recruiting Manager" : "Administrator"}
            </span>
          </span>
          <form action="/auth/signout" method="POST">
            <button type="submit" className="admin-signout" aria-label="Sign out" title="Sign out">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 20H5.5a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2H10" />
                <path d="m16 15.5 4-3.5-4-3.5M20 12H9.5" />
              </svg>
            </button>
          </form>
        </div>
      </aside>

      <button
        type="button"
        className={`admin-sidebar-overlay${open ? " open" : ""}`}
        onClick={close}
        aria-label="Close navigation"
        tabIndex={open ? 0 : -1}
      />
    </>
  );
}

function NavRow({
  row,
  pathname,
  search,
  badges,
}: {
  row: AdminNavRow;
  pathname: string;
  search: string;
  badges: AdminBadges | null;
}) {
  // A locked row is a promise with a step number on it, not a link. Rendering
  // it as an <a> to a route that does not exist is how a rail starts serving
  // 404s to the people who trust it most.
  if (!row.href) {
    return (
      <span className="dash-nav-item locked" title={`Arrives in step ${row.step}`} aria-disabled="true">
        {row.icon}
        <span className="nav-label">{row.label}</span>
        <span className="nav-badge">Soon</span>
      </span>
    );
  }

  const active = isRowActive(row, pathname, search);
  const count = row.counter && badges ? badges[row.counter] : undefined;

  return (
    <Link
      href={row.query ? `${row.href}?${row.query}` : row.href}
      className={`dash-nav-item${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      {row.icon}
      <span className="nav-label">{row.label}</span>
      {typeof count === "number" && count > 0 && (
        <span className={`nav-counter${row.tone ? ` ${row.tone}` : ""}`}>{format(count)}</span>
      )}
    </Link>
  );
}

function format(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

function initials(name: string, email: string): string {
  const source = name.trim() || email.trim();
  if (!source) return "?";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
