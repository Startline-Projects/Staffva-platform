"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  ["/messages", "Messages"],
  // Kept so a client who arrives on the legacy path still reads "Messages"
  // rather than the "Dashboard" fallback during the redirect frame.
  ["/inbox", "Messages"],
  ["/contracts", "Contracts"],
  ["/approvals", "Approvals"],
  ["/billing", "Billing"],
  ["/reviews", "Reviews"],
  ["/help", "Help"],
  ["/interviews", "Interviews"],
  ["/proposals", "Proposals"],
  ["/shortlists", "My Shortlists"],
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
          href="/messages"
          className="topbar-btn"
          aria-label={unread > 0 ? `Messages, ${unread} unread` : "Messages"}
          style={{ position: "relative" }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M2.5 4.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9.5l-3 2.5v-2.5H3.5a1 1 0 0 1-1-1v-8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          {unread > 0 && <span className="unread-dot" />}
        </Link>
        <Link href="/account/security" className="topbar-avatar" aria-label="Account settings">
          {user.initial}
        </Link>
        {/* The rail's sign-out sits in the sidebar footer, which is hidden
            below 880px where the rail becomes a bottom bar — so on a phone
            this is the only way out. */}
        <PortalSignOut />
      </div>
    </header>
  );
}
