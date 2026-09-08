"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import StaffvaLogo from "@/components/landing/StaffvaLogo";
import { PortalNavItem as NavItem } from "@/components/portal/PortalNav";
import PortalSignOut from "@/components/portal/PortalSignOut";
import type { PortalUser } from "./PortalShell";

/**
 * The Atlas sidebar — desktop rail, mobile bottom bar (the extracted CSS
 * handles the swap at 880px). Nav items are the five the prototype actually
 * wires (Dashboard, Find work, Messages, Contracts, Reviews) plus Profile and
 * Help, which have real destinations here.
 *
 * Atlas also shows Earnings, Hours, Calendar, Resources and Refer. In the
 * prototype those five are dead links — no view section, no click handler —
 * and here they have no backend either. Earnings/Hours/Calendar render locked
 * with a "Soon" chip (the prototype ships a .locked style for exactly this);
 * Refer is omitted entirely because its badge promises $200 for a referral
 * program that does not exist, and a locked money promise is still a promise.
 */

export default function PortalSidebar({ user }: { user: PortalUser }) {
  const pathname = usePathname();
  const is = (p: string) => pathname === p || pathname.startsWith(p + "/");

  return (
    <aside className="dash-sidebar" aria-label="Main navigation">
      {/* The established brand lockup, not the prototype's Atlas mark — the
          same treatment every other ported screen uses. */}
      <Link href="/" className="logo" aria-label="StaffVA — home">
        <StaffvaLogo />
      </Link>
      <ul className="dash-nav" role="list">
        {user.mode === "applicant" ? (
          <>
            <NavItem href="/candidate/dashboard" icon="dashboard" label="Dashboard" active={is("/candidate/dashboard")} />
            {/* No "Step N" badge: application_step is a slug, and the real
                step number lives in the dashboard's pipeline derivation —
                duplicating that here is how two surfaces disagree. */}
            <NavItem
              href="/candidate/dashboard#pipelineFullHeading"
              icon="application"
              label="My Application"
            />
            <NavItem href="mailto:support@staffva.com" icon="help" label="Help" />
          </>
        ) : (
          <>
            <NavItem href="/candidate/dashboard" icon="dashboard" label="Dashboard" active={is("/candidate/dashboard")} />
            {user.profilePath && (
              <NavItem href={user.profilePath} icon="profile" label="Profile" active={is(user.profilePath)} mobileHide />
            )}
            <NavItem href="/candidate/work" icon="jobs" label="Find work" active={is("/candidate/work")} />
            <NavItem
              href="/candidate/messages"
              icon="messages"
              label="Messages"
              active={is("/candidate/messages")}
              badge={user.unreadMessages > 0 ? String(user.unreadMessages) : undefined}
            />
            <NavItem href="/candidate/contracts" icon="contracts" label="Contracts" active={is("/candidate/contracts")} />
            <NavItem href="/candidate/reviews" icon="reviews" label="Reviews" active={is("/candidate/reviews")} />
            <NavItem href="#" icon="earnings" label="Earnings" locked />
            <NavItem href="#" icon="hours" label="Hours" locked />
            <NavItem href="#" icon="calendar" label="Calendar" locked />
            <NavItem href="mailto:support@staffva.com" icon="help" label="Help" mobileHide />
          </>
        )}
      </ul>
      <div className="dash-sidebar-footer">
        <div className="avatar-mini" aria-hidden="true">{user.initial}</div>
        <div className="user-name" style={{ flex: 1 }}>
          {user.displayName}
          <span className={`user-status${user.statusLine.endsWith("Available") ? "" : " paused"}`}>
            {user.statusLine}
          </span>
        </div>
        {/* Many candidates work from shared machines; sign-out must not be a
            two-hop scavenger hunt behind the avatar. */}
        <PortalSignOut />
      </div>
    </aside>
  );
}
