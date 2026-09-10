import type { ReactNode } from "react";

/**
 * The admin rail, as data.
 *
 * One list, read by both the rail and the topbar. The old chrome kept a
 * second copy of the destinations in `AdminTopbar.PAGE_NAMES`, and the copy
 * had drifted: `/admin/video-reviews`, `/admin/lockouts`, `/talent-pool` and
 * `/admin/messages` all rendered their crumb as the fallback "Admin". Two of
 * them were worse off than that — no rail row pointed at them at all, so the
 * only way to reach a video review was to know the URL.
 *
 * Rules for editing this list:
 *
 *   · A row with an `href` must go where that surface is TODAY. `/pending-bans`
 *     is not under `/admin` — the old rail linked to `/admin/pending-bans` and
 *     served a 404.
 *   · A row with no `href` is locked: it renders as text with a "Soon" chip,
 *     never as a link to nowhere, and it must name the build step that fills
 *     it in. If there is no step, there should be no row.
 *   · `counter` names a key in the command-center badge payload. A counter is
 *     rendered only when that payload actually arrived — see AdminRail.
 */

export type BadgeKey =
  | "pendingReview"
  | "pendingProfileReview"
  | "triage"
  | "clients"
  | "talentPool"
  | "teamInbox"
  | "pendingBans";

export type AdminBadges = Partial<Record<BadgeKey, number>>;

export interface AdminNavRow {
  label: string;
  /** Destination as it exists today. Omit to render the row locked. */
  href?: string;
  /** Query the row selects, when several rows share one page. */
  query?: string;
  icon: ReactNode;
  counter?: BadgeKey;
  /** Colour of the counter — a queue with a clock on it reads warm or urgent. */
  tone?: "warn" | "urgent";
  /** Build step that turns a locked row into a real one. Required if locked. */
  step?: number;
  /** Hidden from recruiting managers, who see a subset of the panel. */
  adminOnly?: boolean;
}

export interface AdminNavGroup {
  id: string;
  label: string;
  rows: AdminNavRow[];
}

/* ── icons ── stroke set at 24, matching the Atlas admin prototype ── */
const ic = (d: ReactNode) => (
  <svg
    className="nav-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {d}
  </svg>
);

const ICON = {
  dashboard: ic(<><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></>),
  queue: ic(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>),
  profile: ic(<><circle cx="12" cy="8" r="4" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></>),
  triage: ic(<><path d="M3 12h4l2.5-7 5 14 2.5-7h4" /></>),
  identity: ic(<><rect x="2.5" y="5" width="19" height="14" rx="2" /><circle cx="9" cy="11.5" r="2.2" /><path d="M5.5 16.5c.6-1.6 1.9-2.4 3.5-2.4s2.9.8 3.5 2.4M15.5 10h3.5M15.5 13.5h3.5" /></>),
  video: ic(<><rect x="2.5" y="6" width="13" height="12" rx="2" /><path d="m15.5 10.5 6-3.5v10l-6-3.5z" /></>),
  duplicate: ic(<><rect x="8.5" y="8.5" width="12" height="12" rx="2" /><path d="M15.5 5.5h-10a2 2 0 0 0-2 2v10" /></>),
  lock: ic(<><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></>),
  pool: ic(<><circle cx="9" cy="8" r="3.4" /><path d="M2.5 19c.7-3.2 3.2-5 6.5-5s5.8 1.8 6.5 5" /><path d="M16 5.4a3.4 3.4 0 0 1 0 6.6M17.5 14.4c2.3.6 3.7 2.2 4.2 4.6" /></>),
  client: ic(<><rect x="2.5" y="7" width="19" height="13" rx="2" /><path d="M16 20V5.5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2V20" /></>),
  specialist: ic(<><path d="M12 21.5s7.5-3.8 7.5-9.5V5.2L12 2.5 4.5 5.2V12c0 5.7 7.5 9.5 7.5 9.5z" /><path d="m9 11.8 2 2 4-4" /></>),
  admins: ic(<><circle cx="12" cy="7.5" r="3.5" /><path d="M5 20c.7-3.4 3.4-5.2 7-5.2s6.3 1.8 7 5.2" /><path d="M18.5 3.5 20 5l-1.5 1.5" /></>),
  engagement: ic(<><path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z" /><path d="M14 2.5V8h5.5" /><path d="M8.5 13h7M8.5 16.5h4.5" /></>),
  dispute: ic(<><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4.5M12 17.2v.1" /></>),
  review: ic(<><path d="m12 2.8 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.6l6.5-.9z" /></>),
  message: ic(<><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></>),
  report: ic(<><path d="M6 20v-4.5M12 20V8M18 20v-8.5" /><path d="M3 20h18" /></>),
  ban: ic(<><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>),
  suspicious: ic(<><path d="M1.8 12S5.8 4.5 12 4.5 22.2 12 22.2 12 18.2 19.5 12 19.5 1.8 12 1.8 12z" /><circle cx="12" cy="12" r="3" /></>),
  settings: ic(<><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0V21a1.6 1.6 0 0 0-2.7-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 3.6a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4z" /></>),
  vendor: ic(<><path d="M3 12h4l2 5 4-12 2.5 7H21" /></>),
  team: ic(<><path d="M3 5.5h18v11a1.5 1.5 0 0 1-1.5 1.5H8l-5 4z" /><path d="M7.5 10h9M7.5 13.2h5.5" /></>),
} as const;

/** Reached from the rail footer rather than a rail row, but the topbar still
 *  has to be able to name it — see `pageTitle`. */
export const ADMIN_PROFILE_ROW: AdminNavRow = {
  label: "My profile",
  href: "/admin/profile",
  icon: ICON.profile,
};

export const ADMIN_NAV_TOP: AdminNavRow = {
  label: "Dashboard",
  href: "/admin",
  icon: ICON.dashboard,
  adminOnly: true,
};

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    id: "pipeline",
    label: "Pipeline",
    rows: [
      { label: "Review Queue", href: "/admin/candidates", icon: ICON.queue, counter: "pendingReview" },
      { label: "Profile Reviews", href: "/admin/candidates", query: "status=pending_review", icon: ICON.profile, counter: "pendingProfileReview", tone: "warn" },
      { label: "Triage", href: "/admin/triage", icon: ICON.triage, counter: "triage", tone: "urgent" },
      { label: "Identity", href: "/admin/identity", icon: ICON.identity },
      { label: "Video Reviews", href: "/admin/video-reviews", icon: ICON.video },
      { label: "Duplicates", href: "/admin/duplicates", icon: ICON.duplicate },
      { label: "Lockouts", href: "/admin/lockouts", icon: ICON.lock },
    ],
  },
  {
    id: "directory",
    label: "Directory",
    rows: [
      { label: "All users", href: "/admin/users", icon: ICON.pool },
      { label: "Talent Pool", href: "/talent-pool", icon: ICON.report, counter: "talentPool" },
      { label: "Clients", href: "/admin/clients", icon: ICON.client, counter: "clients", adminOnly: true },
      { label: "Talent Specialists", href: "/admin/recruiters", icon: ICON.specialist },
      { label: "Managers & Admins", href: "/admin/staff", icon: ICON.admins },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    rows: [
      { label: "Engagements", href: "/admin/engagements", icon: ICON.engagement },
      { label: "Job postings", href: "/admin/jobs", icon: ICON.client },
      { label: "Disputes", href: "/admin/disputes", icon: ICON.dispute },
      { label: "Reviews", href: "/admin/reviews", icon: ICON.review },
      { label: "Unanswered Messages", href: "/admin/messages", icon: ICON.message },
      { label: "Reports", href: "/admin/reports", icon: ICON.report },
    ],
  },
  {
    id: "trust",
    label: "Trust & Safety",
    rows: [
      { label: "Pending Bans", href: "/pending-bans", icon: ICON.ban, counter: "pendingBans", tone: "urgent" },
      { label: "Suspicious Activity", href: "/admin/suspicious", icon: ICON.suspicious },
      { label: "Audit log", href: "/admin/audit", icon: ICON.queue },
    ],
  },
  {
    id: "platform",
    label: "Platform",
    rows: [
      { label: "Settings", href: "/admin/settings", icon: ICON.settings },
      { label: "Vendor Health", icon: ICON.vendor, step: 12 },
    ],
  },
  {
    id: "internal",
    label: "Internal",
    rows: [{ label: "Team Inbox", href: "/admin/team", icon: ICON.team, counter: "teamInbox" }],
  },
];

/** Every row the signed-in role may see, flattened. */
export function visibleRows(isRecruitingManager: boolean): AdminNavRow[] {
  const rows = [ADMIN_NAV_TOP, ...ADMIN_NAV.flatMap((g) => g.rows)];
  return isRecruitingManager ? rows.filter((r) => !r.adminOnly) : rows;
}

/**
 * Is this row the one being viewed?
 *
 * `Review Queue` and `Profile Reviews` are the same page under different
 * filters, so a row that names a query only matches when that query is set,
 * and a row without one only matches when it is not. Matching on the path
 * alone — what the old rail did — lit both rows at once, and since it
 * compared `pathname` against a href carrying `?status=…`, in practice it lit
 * neither.
 */
export function isRowActive(row: AdminNavRow, pathname: string, search: string): boolean {
  if (!row.href) return false;
  if (row.href === "/admin") return pathname === "/admin";

  const pathMatches = pathname === row.href || pathname.startsWith(`${row.href}/`);
  if (!pathMatches) return false;

  const siblingQueries = ADMIN_NAV.flatMap((g) => g.rows)
    .filter((r) => r.href === row.href && r.query)
    .map((r) => r.query!);

  if (row.query) return siblingQueries.some((q) => q === row.query) && search.includes(row.query);
  return !siblingQueries.some((q) => search.includes(q));
}

/** The crumb the topbar shows. Falls back to the section, never to nothing. */
export function pageTitle(pathname: string, search: string): string {
  const rows = [ADMIN_NAV_TOP, ADMIN_PROFILE_ROW, ...ADMIN_NAV.flatMap((g) => g.rows)];
  const hit = rows.find((r) => isRowActive(r, pathname, search));
  return hit?.label ?? "Admin";
}
