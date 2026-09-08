"use client";

import Link from "next/link";

/**
 * The shared sidebar vocabulary for both portal rails: one icon set, one
 * nav-item renderer, one section label. The candidate and client rails list
 * different destinations, but a rail item must look and behave identically
 * on both sides — two copies of this is how the locked-row treatment or the
 * badge drifts between verticals.
 *
 * The locked state is the honest placeholder for a destination that does not
 * exist yet: it renders as text with a "Soon" chip, never as a link that goes
 * nowhere. Every locked row must correspond to a numbered build step.
 */

export const PORTAL_NAV_ICONS: Record<string, React.ReactNode> = {
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
  /* ── client rail ── */
  browse: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="7" cy="6" r="2.8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 14.5c.4-2.4 2.3-3.8 4.5-3.8s4.1 1.4 4.5 3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12.5 4.5h3M12.5 7.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  shortlists: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 14.5S3 11 3 7.2A2.9 2.9 0 0 1 9 5.6a2.9 2.9 0 0 1 6 1.6c0 3.8-6 7.3-6 7.3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  interviews: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2.5" y="5" width="9" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="m11.5 9 4-2.2v4.4L11.5 9Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  proposals: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4 2.5h10v13H4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.5 6.5h5M6.5 9h5M6.5 11.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  billing: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2" y="4" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 7.5h14" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  shield: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 1.8 3 4.2v4.1c0 3.4 2.5 6.4 6 7.1 3.5-.7 6-3.7 6-7.1V4.2L9 1.8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m6.6 8.8 1.7 1.7 3.1-3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  settings: (
    <svg className="nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="2.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 1.8v2M9 14.2v2M16.2 9h-2M3.8 9h-2M14.1 3.9l-1.4 1.4M5.3 12.7l-1.4 1.4M14.1 14.1l-1.4-1.4M5.3 5.3 3.9 3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
};

export function PortalNavSection({ label }: { label: string }) {
  return (
    <li className="nav-mobile-hide" aria-hidden="true">
      <span className="dash-nav-section">{label}</span>
    </li>
  );
}

export function PortalNavItem({
  href,
  icon,
  label,
  active,
  badge,
  locked,
  lockedTitle,
  mobileHide,
}: {
  href: string;
  icon: string;
  label: string;
  active?: boolean;
  badge?: string;
  locked?: boolean;
  /** What the row is waiting on, e.g. "Arrives with billing". */
  lockedTitle?: string;
  /** ≤880px the sidebar becomes a bottom bar holding about five chips, so
      secondary destinations give way (they stay reachable from their pages). */
  mobileHide?: boolean;
}) {
  if (locked) {
    return (
      <li className="nav-mobile-hide">
        <span className="dash-nav-item locked" aria-disabled="true" title={lockedTitle || "Not available yet"}>
          {PORTAL_NAV_ICONS[icon]}
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
      {PORTAL_NAV_ICONS[icon]}
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
