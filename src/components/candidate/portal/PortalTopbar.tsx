"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import NotifBell from "./NotifBell";
import type { PortalUser } from "./PortalShell";

/**
 * Atlas topbar: crumb (mobile shows the wordmark), the notifications bell
 * (live mode only — matching the prototype, where .topbar-bell-wrap is hidden
 * until .live-mode), a messages shortcut, and the avatar.
 *
 * The prototype's crumb is static ("Dashboard", never updated); here it
 * follows the route, which is the obvious intent of a crumb.
 */
const CRUMBS: Array<[prefix: string, label: string]> = [
  ["/candidate/work", "Find work"],
  ["/candidate/messages", "Messages"],
  ["/candidate/contracts", "Contracts"],
  ["/candidate/reviews", "Reviews"],
  ["/candidate/dashboard", "Dashboard"],
];

export default function PortalTopbar({ user }: { user: PortalUser }) {
  const pathname = usePathname();
  const crumb = CRUMBS.find(([p]) => pathname.startsWith(p))?.[1] ?? "Dashboard";

  return (
    <header className="dash-topbar">
      <div className="topbar-crumb">
        <span className="mobile-logo">StaffVA</span>
        <span>{crumb}</span>
      </div>
      <div className="topbar-actions">
        {user.mode === "live" && <NotifBell />}
        <Link
          href="/candidate/messages"
          className="topbar-btn"
          aria-label="Messages"
          style={{ position: "relative" }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M2.5 4.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9.5l-3 2.5v-2.5H3.5a1 1 0 0 1-1-1v-8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          {user.unreadMessages > 0 && <span className="unread-dot" aria-label={`${user.unreadMessages} unread`} />}
        </Link>
        <Link href="/account/security" className="topbar-avatar" aria-label="Account">
          {user.initial}
        </Link>
      </div>
    </header>
  );
}
