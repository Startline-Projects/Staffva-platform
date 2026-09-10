"use client";

import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { pageTitle } from "./adminNav";
import { useAdminDrawer } from "./AdminDrawer";
import AdminAttentionBell from "./AdminAttentionBell";

/**
 * The admin topbar.
 *
 * The dashboard's Export and Approve controls live up here but act on the
 * page, so they keep talking to it over the `adc-open-modal` event the
 * dashboard already listens for. Renaming or dropping that event silently
 * disconnects both buttons — the listener is in
 * `src/app/(admin)/admin/page.tsx`.
 */
function emitDashboardModal(name: string) {
  window.dispatchEvent(new CustomEvent("adc-open-modal", { detail: name }));
}

export default function AdminBar({ isRecruitingManager }: { isRecruitingManager: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams().toString();
  const { open, toggle } = useAdminDrawer();
  const [time, setTime] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Rendered empty on the server and filled in on the client: a clock in the
  // initial HTML is a guaranteed hydration mismatch.
  useEffect(() => {
    function tick() {
      setTime(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ⌘K / Ctrl-K opens search. The rail already owns "/" for its own filter,
  // so the two shortcuts do not collide.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      if (searchRef.current) {
        searchRef.current.focus();
        searchRef.current.select();
      } else {
        router.push("/admin/search");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const title = pageTitle(pathname, search);
  const isDashboard = pathname === "/admin";

  return (
    <div className="dash-topbar">
      <div className="admin-topbar-left">
        <button
          type="button"
          className="admin-hamburger"
          onClick={toggle}
          aria-label="Open navigation"
          aria-expanded={open}
          aria-controls="adminRail"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" />
          </svg>
        </button>
        <span className="admin-crumb">
          Command Center <span aria-hidden="true">/</span>{" "}
          <span className="admin-crumb-page">{title}</span>
        </span>
      </div>

      <form method="get" action="/admin/search" className="topbar-search" role="search">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7.5" /><path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={searchRef}
          type="text"
          name="q"
          placeholder="Search anyone, anything, or an id…"
          aria-label="Search everything"
        />
        <span className="topbar-search-kbd" aria-hidden="true">⌘K</span>
      </form>

      <div className="admin-topbar-right">
        <span className="restricted-pill" title="Staff-only surface">
          <span className="restricted-dot" aria-hidden="true" />
          Restricted
        </span>

        <span
          className="admin-role-pill"
          data-role={isRecruitingManager ? "recruiting_manager" : "admin"}
        >
          <span className="admin-role-dot" aria-hidden="true" />
          {isRecruitingManager ? "Recruiting Mgr" : "Admin"}
        </span>

        <AdminAttentionBell />

        <span className="admin-clock" suppressHydrationWarning>{time}</span>

        {isDashboard && (
          <>
            <button type="button" className="admin-topbar-btn" onClick={() => emitDashboardModal("export")}>
              Export
            </button>
            <button type="button" className="admin-topbar-btn primary" onClick={() => emitDashboardModal("approve")}>
              Approve candidate
            </button>
          </>
        )}
      </div>
    </div>
  );
}
