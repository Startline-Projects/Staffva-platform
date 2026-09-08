"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import StaffvaLogo from "@/components/landing/StaffvaLogo";
import { PortalNavItem, PortalNavSection } from "@/components/portal/PortalNav";
import PortalSignOut from "@/components/portal/PortalSignOut";
import { useUnreadMessages } from "./UnreadMessages";
import type { ClientPortalUser } from "./ClientPortalShell";

/**
 * The client rail, in Atlas's item order and grouping (Dashboard / Browse /
 * Shortlists · Hiring · Engagements · Account).
 *
 * The rule for every row: it goes where that thing actually is TODAY. Most
 * of the client product currently lives as sections of the /team dashboard,
 * so those rows deep-link to the section — each gets its own page in its
 * numbered step, and only the href changes. A row is locked with a "Soon"
 * chip ONLY when the thing does not exist anywhere yet; review caught the
 * first draft locking four rows whose features were working on the very
 * page beneath them, which would have told a client with a contract to sign
 * that contracts weren't built.
 *
 * Genuinely absent, and what unlocks it: My Shortlists (step 8 — today's
 * shortlists are per-job match lists reachable from a job post, not saved
 * lists).
 *
 * Cut on record: Atlas's "My Talent Specialist" row. The owner's D5 retires
 * the specialist concept on both sides — clients get the Help Center in step
 * 17, and this rail's Help goes to real support until then.
 *
 * The `active` states below only light up for routes inside this route
 * group; the others still live in (main) or outside it and move in with
 * their steps.
 */
export default function ClientPortalSidebar({ user }: { user: ClientPortalUser }) {
  const pathname = usePathname();
  const unread = useUnreadMessages();
  const is = (p: string) => pathname === p || pathname.startsWith(p + "/");

  return (
    <aside className="dash-sidebar" aria-label="Main navigation">
      {/* Home for a signed-in client is their dashboard, not the marketing
          landing page they last saw before signing up. */}
      <Link href="/team" className="logo" aria-label="StaffVA — dashboard">
        <StaffvaLogo />
      </Link>
      <ul className="dash-nav" role="list">
        <PortalNavItem href="/team" icon="dashboard" label="Dashboard" active={is("/team")} />
        <PortalNavItem href="/browse" icon="browse" label="Browse Talent" active={is("/browse")} />
        <PortalNavItem href="#" icon="shortlists" label="My Shortlists" locked lockedTitle="Saved lists of candidates arrive soon" />

        <PortalNavSection label="Hiring" />
        <PortalNavItem href="/team#roles" icon="jobs" label="Jobs" mobileHide />
        <PortalNavItem
          href="/inbox"
          icon="messages"
          label="Messages"
          active={is("/inbox")}
          badge={unread > 0 ? String(unread) : undefined}
        />
        <PortalNavItem href="/team#interviews" icon="interviews" label="Interviews" mobileHide />
        <PortalNavItem href="/team#offers" icon="proposals" label="Proposals" mobileHide />

        <PortalNavSection label="Engagements" />
        {/* Contracts, approvals and reviews all live inside the engagement
            cards today — one section, three ways in, until steps 13/14/16
            give each its own page. */}
        <PortalNavItem href="/team#engagements" icon="contracts" label="Contracts" mobileHide />
        {/* Atlas calls this "Time & Approvals". There is no time to track —
            the owner's D2 keeps funded periods and rules out timesheets — so
            it is the approvals queue and says so. */}
        <PortalNavItem href="/team#engagements" icon="hours" label="Approvals" mobileHide />
        <PortalNavItem href="/team#escrow" icon="billing" label="Billing" mobileHide />
        <PortalNavItem href="/team#engagements" icon="reviews" label="Reviews" mobileHide />

        <PortalNavSection label="Account" />
        {/* A permanent way back to verification. The banner is dismissible
            and disappears entirely once nothing is outstanding, which left
            /verify reachable only by URL — including for anyone needing to
            replace an expired card. */}
        <PortalNavItem
          href="/verify"
          icon="shield"
          label={user.needsVerification || user.needsCard ? "Verify to fund" : "Verification"}
          active={is("/verify")}
          badge={user.needsVerification || user.needsCard ? "Todo" : undefined}
          mobileHide
        />
        <PortalNavItem href="/account/security" icon="settings" label="Account Settings" active={is("/account")} mobileHide />
        <PortalNavItem href="mailto:support@staffva.com" icon="help" label="Help" mobileHide />
      </ul>
      <div className="dash-sidebar-footer">
        <div className="avatar-mini" aria-hidden="true">{user.initial}</div>
        <div className="user-name" style={{ flex: 1 }}>
          {user.displayName}
          <span className="user-status">{user.subtitle}</span>
        </div>
        <PortalSignOut />
      </div>
    </aside>
  );
}
