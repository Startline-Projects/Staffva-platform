/**
 * What each staff role can actually do — read off the guards, not invented.
 *
 * StaffVA has no permissions table. Access is decided by `role` in the JWT
 * and a hand-written check at the top of each route handler, which means the
 * only honest way to describe a role's reach is to enumerate those checks.
 * Every row below names the file its answer comes from, so a reader can go
 * verify it and a future editor knows what to keep in step.
 *
 * The checks were read on 2026-09-09. If you change a guard, change the row.
 *
 * `recruiter` is deliberately absent: recruiters do not use `/admin/*` at all
 * (the layout redirects them), they work out of `/recruiter` against their
 * own assigned queue. A few admin endpoints admit them for that queue, which
 * is noted where it applies rather than given a column of its own.
 */

export type StaffRole = "admin" | "recruiting_manager";

export interface Capability {
  name: string;
  note: string;
  /** Route handler whose guard decides this. */
  source: string;
  /** Roles the guard lets through. */
  roles: StaffRole[];
}

export interface CapabilityDomain {
  id: string;
  label: string;
  items: Capability[];
}

const BOTH: StaffRole[] = ["admin", "recruiting_manager"];
const ADMIN_ONLY: StaffRole[] = ["admin"];

export const CAPABILITIES: CapabilityDomain[] = [
  {
    id: "candidates",
    label: "Candidates",
    items: [
      {
        name: "Open the review queue",
        note: "See every candidate in the screening pipeline and their scores.",
        source: "api/admin/screening-queue",
        roles: BOTH,
      },
      {
        name: "Edit a candidate record",
        note: "Change profile fields, role category, rate and assignment.",
        source: "api/admin/candidates/update",
        roles: BOTH,
      },
      {
        name: "Request profile revisions",
        note: "Send a candidate back with written feedback. Recruiters may also do this, but only for candidates assigned to them.",
        source: "api/admin/candidates/review · action=revision_required",
        roles: BOTH,
      },
      {
        name: "Approve a candidate to live",
        note: "Put a candidate into the marketplace. Every action on this route other than a revision request is admin-only.",
        source: "api/admin/candidates/review · verifyAdmin()",
        roles: ADMIN_ONLY,
      },
      {
        name: "Reject a candidate",
        note: "Close an application. Same admin-only guard as approval.",
        source: "api/admin/candidates/review · verifyAdmin()",
        roles: ADMIN_ONLY,
      },
    ],
  },
  {
    id: "trust",
    label: "Trust & safety",
    items: [
      {
        name: "Review ID verification",
        note: "Read identity sessions and record a manual pass or fail.",
        source: "api/admin/identity",
        roles: BOTH,
      },
      {
        name: "Lift a test lockout",
        note: "Let a candidate back into the English test before the lockout expires.",
        source: "api/admin/lockouts",
        roles: BOTH,
      },
      {
        name: "Review photos and video intros",
        note: "Approve or reject the media a candidate submits for their profile.",
        source: "api/admin/photo-review · api/admin/video-review",
        roles: BOTH,
      },
      {
        name: "Resolve duplicate accounts",
        note: "Look at suspected duplicates and clear or act on them.",
        source: "api/admin/duplicates",
        roles: BOTH,
      },
      {
        name: "Confirm or dismiss a ban",
        note: "Rule on a ban a talent specialist has requested. Admin-only — the person who asks for a ban cannot also grant it.",
        source: "api/admin/pending-bans",
        roles: ADMIN_ONLY,
      },
    ],
  },
  {
    id: "clients",
    label: "Clients & revenue",
    items: [
      {
        name: "Mission control dashboard",
        note: "Platform fees, engagements, client health and the alert queue.",
        source: "api/admin/command-center",
        roles: ADMIN_ONLY,
      },
      {
        name: "Client directory",
        note: "Every client account with spend and browse activity.",
        source: "api/admin/clients",
        roles: ADMIN_ONLY,
      },
      {
        name: "Platform metrics and readiness",
        note: "Aggregate reporting across the marketplace.",
        source: "api/admin/metrics · api/admin/readiness",
        roles: ADMIN_ONLY,
      },
    ],
  },
  {
    id: "platform",
    label: "Platform",
    items: [
      {
        name: "Talent specialist directory",
        note: "See specialists, their queues and their scoring.",
        source: "api/admin/recruiters · api/admin/recruiter-scoring",
        roles: BOTH,
      },
      {
        name: "Moderate reviews",
        note: "Read both directions of every review pair and take one down.",
        source: "api/admin/reviews",
        roles: BOTH,
      },
      {
        name: "Answer client messages",
        note: "Reply to threads nobody on the platform has answered.",
        source: "api/admin/messages",
        roles: BOTH,
      },
      {
        name: "Change platform settings",
        note: "Edit the settings that drive thresholds and toggles.",
        source: "api/admin/settings",
        roles: BOTH,
      },
    ],
  },
];

export function can(role: StaffRole, cap: Capability): boolean {
  return cap.roles.includes(role);
}

/** How much of a domain a role reaches — drives the header summary. */
export function domainSummary(role: StaffRole, domain: CapabilityDomain) {
  const allowed = domain.items.filter((c) => can(role, c)).length;
  const total = domain.items.length;
  const level = allowed === total ? "full" : allowed === 0 ? "none" : "partial";
  return { allowed, total, level } as const;
}

export const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Administrator",
  recruiting_manager: "Recruiting manager",
};
