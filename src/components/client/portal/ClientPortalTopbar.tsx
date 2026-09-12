"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import PortalAccountMenu from "@/components/portal/PortalAccountMenu";
import PortalSignOut from "@/components/portal/PortalSignOut";
import PortalNotifBell from "@/components/portal/PortalNotifBell";
import { useUnreadMessages } from "./UnreadMessages";
import type { ClientPortalUser } from "./ClientPortalShell";

/**
 * Atlas's client topbar: the crumb, the lime "Hire Talent" call to action,
 * a messages shortcut with the unread dot, and the avatar.
 *
 * The prototype's crumb is static ("Dashboard", never updated); here it
 * follows the route, which is the obvious intent of a crumb.
 *
 * Not here yet, deliberately: the ⌘K global search (display-only in the
 * prototype, no search backend here) and the notifications bell (step 3).
 * The avatar links straight to account settings rather than opening Atlas's
 * dropdown, because four of that menu's six items — Profile, Billing, Team
 * Members, Help Center — are surfaces that do not exist yet; the menu
 * arrives with them.
 */
const CRUMBS: Array<[prefix: string, label: string]> = [
  ["/team", "Dashboard"],
  ["/browse", "Browse Talent"],
  ["/post-a-job", "Jobs"],
  ["/post-role", "Jobs"],
  ["/inbox", "Messages"],
  ["/account", "Account Settings"],
];

export default function ClientPortalTopbar({ user }: { user: ClientPortalUser }) {
  const pathname = usePathname();
  const unread = useUnreadMessages();
  const crumb = CRUMBS.find(([p]) => pathname.startsWith(p))?.[1] ?? "Dashboard";

  return (
    <header className="dash-topbar">
      <div className="topbar-crumb">
        <span className="mobile-logo">StaffVA</span>
        <span>{crumb}</span>
      </div>
      <div className="topbar-actions">
        <Link href="/browse" className="topbar-cta">Hire Talent</Link>
        <PortalNotifBell
          endpoint="/api/client/notifications"
          settingsRoute="/settings/notifications"
          emptyText="Nothing yet. Replies, counters, signatures and approvals all land here."
        />
        <Link
          href="/inbox"
          className="topbar-btn"
          aria-label={unread > 0 ? `Messages, ${unread} unread` : "Messages"}
          style={{ position: "relative" }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M2.5 4.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9.5l-3 2.5v-2.5H3.5a1 1 0 0 1-1-1v-8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          {unread > 0 && <span className="unread-dot" />}
        </Link>
        <PortalAccountMenu
          initial={user.initial}
          displayName={user.displayName}
          statusLine={user.subtitle}
          items={[
            { href: "/settings/notifications", label: "Notification settings" },
            { href: "/settings/security", label: "Two-step verification" },
            // No /help route exists in this app — the only real support
            // channel is the address the candidate rail already uses.
            { href: "mailto:support@staffva.com", label: "Help", external: true },
          ]}
        />
        {/* Kept ALONGSIDE the menu's sign-out, not replaced by it. The rail's
            copy lives in the sidebar footer, which is hidden below 880px where
            the rail becomes a bottom bar — and a way out must never be one tap
            deeper on a shared machine. */}
        <PortalSignOut />
      </div>
    </header>
  );
}
