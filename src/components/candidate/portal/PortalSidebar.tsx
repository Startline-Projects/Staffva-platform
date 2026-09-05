"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import StaffvaLogo from "@/components/landing/StaffvaLogo";
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

const NAV_ICONS: Record<string, React.ReactNode> = {
  dashboard: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2.5 9 9 3l6.5 6M4.5 8v6.5h9V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  application: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4 2.5h7.5L14 5v10.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.5 8.5h5M6.5 11h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  profile: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="7" r="3.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 16c.5-3 3-4.5 6-4.5s5.5 1.5 6 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  jobs: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m12 12 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  messages: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3 4h12v9a1 1 0 0 1-1 1H6l-3 2.5V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  contracts: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4 2.5h7L14 5v10.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m6 10 2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  earnings: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 3v12M5.5 6.5h5a2 2 0 0 1 0 4h-3a2 2 0 0 0 0 4h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  hours: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 5v4l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  reviews: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 2.5 11 7l5 .5-3.5 3.5L13.5 16 9 13.5 4.5 16l1-5L2 7.5 7 7l2-4.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  calendar: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="12" height="11" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 7h12M6 2v4M12 2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  help: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 7a2 2 0 0 1 4 0c0 1-1 1.5-2 2v1M9 12.5v.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
};

function NavItem({
  href,
  icon,
  label,
  active,
  badge,
  locked,
  mobileHide,
}: {
  href: string;
  icon: string;
  label: string;
  active?: boolean;
  badge?: string;
  locked?: boolean;
  /** ≤880px the sidebar becomes a bottom bar that holds five chips; the
      prototype ships no mobile layout for its 12-item rail, so secondary
      destinations give way (they stay reachable — Profile via the dashboard,
      Help via mail). */
  mobileHide?: boolean;
}) {
  if (locked) {
    return (
      <li className="nav-mobile-hide">
        <span className="dash-nav-item locked" aria-disabled="true" title="Not available yet">
          {NAV_ICONS[icon]}
          <span className="nav-label">{label}</span>
          <span className="nav-badge">Soon</span>
        </span>
      </li>
    );
  }
  const external = href.startsWith("mailto:");
  const cls = `dash-nav-item${active ? " active" : ""}`;
  const liCls = mobileHide ? "nav-mobile-hide" : undefined;
  const inner = (
    <>
      {NAV_ICONS[icon]}
      <span className="nav-label">{label}</span>
      {badge && <span className="nav-badge">{badge}</span>}
    </>
  );
  return (
    <li className={liCls}>
      {external ? (
        <a href={href} className={cls}>{inner}</a>
      ) : (
        <Link href={href} className={cls} aria-current={active ? "page" : undefined}>{inner}</Link>
      )}
    </li>
  );
}

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
        <form action="/auth/signout" method="POST">
          <button
            type="submit"
            aria-label="Sign out"
            title="Sign out"
            style={{ display: "flex", alignItems: "center", padding: 6, borderRadius: 6, color: "var(--ink-mute)" }}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 2H3.5A1.5 1.5 0 0 0 2 3.5v9A1.5 1.5 0 0 0 3.5 14H6M10.5 11.5 14 8l-3.5-3.5M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
      </div>
    </aside>
  );
}
