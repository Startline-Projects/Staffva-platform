/**
 * What needs someone's attention, derived once.
 *
 * This lived inside the dashboard component, which meant the only way to know
 * whether anything was waiting was to be on the dashboard. The bell in the
 * topbar needs the same answer on every page, and two copies of "what counts
 * as urgent" would have drifted the first time either changed.
 *
 * Deliberately derived, not stored. There is no `admin_notifications` table
 * and this step did not add one: every row below is a live count of a real
 * condition, so it clears itself when the condition clears. A notification
 * table would need a writer at every event, and would then disagree with the
 * database the moment one of those writers was missed — which is precisely
 * the failure mode the rest of this panel has spent fourteen steps removing.
 *
 * The cost of that choice is honest too: there is no per-admin read state,
 * because there is nothing to mark read. The bell counts conditions, not
 * messages.
 */

export type AlertPriority = "urgent" | "today" | "week";

export interface AlertInput {
  totalCandidates: number;
  pendingProfileReview: number;
  needsRouting: number;
  screeningHold: number;
  testLockouts: number;
  coldClients: number;
  thinRoles: number;
  pendingBans: number;
  openDisputes: number;
  vendorsDown: string[];
}

export interface DerivedAlert {
  id: string;
  priority: AlertPriority;
  title: string;
  meta: string[];
  sla?: { text: string; tone: "critical" | "warn" | "" };
  actionLabel: string;
  href?: string;
  /** Names a modal on the dashboard; the bell renders these as links instead. */
  modal?: string;
  /** Where the bell should send someone when there is no modal to open. */
  bellHref: string;
}

const PRIORITY_ORDER: AlertPriority[] = ["urgent", "today", "week"];
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

export function deriveAlerts(d: AlertInput): DerivedAlert[] {
  const list: DerivedAlert[] = [];

  for (const vendor of d.vendorsDown) {
    list.push({
      id: `vendor-${vendor}`,
      priority: "urgent",
      title: `${vendor} is failing every health check`,
      meta: ["Anything that calls it is broken meanwhile"],
      sla: { text: "Vendor down", tone: "critical" },
      actionLabel: "Vendor health",
      href: "/admin/vendors",
      bellHref: "/admin/vendors",
    });
  }

  if (d.pendingBans > 0) {
    const n = d.pendingBans;
    list.push({
      id: "pending-bans",
      priority: "urgent",
      title: `${n} ban ${plural(n, "request")} ${plural(n, "is", "are")} waiting on a ruling`,
      meta: ["Only an administrator can grant one"],
      sla: { text: "Decision owed", tone: "critical" },
      actionLabel: "Rule on them",
      href: "/pending-bans",
      bellHref: "/pending-bans",
    });
  }

  if (d.openDisputes > 0) {
    const n = d.openDisputes;
    list.push({
      id: "disputes",
      priority: "urgent",
      title: `${n} open ${plural(n, "dispute")} ${plural(n, "holds", "hold")} money in escrow`,
      meta: ["Nothing moves until each is decided"],
      sla: { text: "Money held", tone: "critical" },
      actionLabel: "Open disputes",
      href: "/admin/disputes",
      bellHref: "/admin/disputes",
    });
  }

  if (d.pendingProfileReview > 0) {
    const n = d.pendingProfileReview;
    list.push({
      id: "profile-review",
      priority: n >= 10 ? "urgent" : "today",
      title: `${n} ${plural(n, "candidate")} waiting on a profile review`,
      meta: ["Nobody goes live until these clear"],
      sla: n >= 10 ? { text: "Backlog", tone: "critical" } : undefined,
      actionLabel: "Review",
      modal: "review",
      bellHref: "/admin/candidates",
    });
  }

  if (d.needsRouting > 0) {
    const n = d.needsRouting;
    list.push({
      id: "routing",
      priority: "urgent",
      title: `${n} ${plural(n, "candidate")} ${plural(n, "has", "have")} no talent specialist`,
      meta: ["Unrouted candidates sit in nobody's queue"],
      sla: { text: "Unassigned", tone: "critical" },
      actionLabel: "Route",
      modal: "route",
      bellHref: "/admin/triage",
    });
  }

  if (d.screeningHold > 0) {
    const n = d.screeningHold;
    const pool = d.totalCandidates || 0;
    const share = pool > 0 ? Math.round((n / pool) * 100) : 0;
    // The share is in the title on purpose. A tag sitting on most of the pool
    // is a statement about the tag, not a queue of people to work through.
    const dominant = pool > 0 && n / pool > 0.5;
    list.push({
      id: "flagged",
      priority: dominant ? "week" : "today",
      title: dominant
        ? `Screening has tagged ${share}% of candidates Hold (${n.toLocaleString()} of ${pool.toLocaleString()})`
        : `${n} ${plural(n, "candidate")} flagged Hold by screening`,
      meta: dominant
        ? ["A tag on most of the pool is not sorting anything — worth re-running rather than working through"]
        : ["Screening tag: Hold"],
      sla: dominant ? undefined : { text: "Needs a human", tone: "warn" },
      actionLabel: "See the split",
      href: dominant ? "/admin/reports?d=cand_screening" : "/admin/candidates",
      bellHref: dominant ? "/admin/reports?d=cand_screening" : "/admin/candidates",
    });
  }

  if (d.testLockouts > 0) {
    const n = d.testLockouts;
    list.push({
      id: "lockouts",
      priority: "week",
      title: `${n} ${plural(n, "candidate")} locked out of the English test`,
      meta: ["Blocked until the lockout expires or is lifted"],
      actionLabel: "Open lockouts",
      href: "/admin/lockouts",
      bellHref: "/admin/lockouts",
    });
  }

  if (d.coldClients > 0) {
    const n = d.coldClients;
    list.push({
      id: "warm-leads",
      priority: "week",
      title: `${n} ${plural(n, "client")} browsed and never hired`,
      meta: ["No active engagement, no recent visit"],
      actionLabel: "See who",
      modal: "followup",
      bellHref: "/admin/clients",
    });
  }

  if (d.thinRoles > 0) {
    const n = d.thinRoles;
    list.push({
      id: "role-depth",
      priority: "week",
      title: `${n} ${plural(n, "role")} ${plural(n, "has", "have")} thin bench depth`,
      meta: ["Fewer than 2 candidates in the pipeline per live candidate"],
      actionLabel: "Open talent pool",
      href: "/talent-pool",
      bellHref: "/talent-pool",
    });
  }

  return list.sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));
}

export function countByPriority(alerts: DerivedAlert[]) {
  return {
    all: alerts.length,
    urgent: alerts.filter((a) => a.priority === "urgent").length,
    today: alerts.filter((a) => a.priority === "today").length,
    week: alerts.filter((a) => a.priority === "week").length,
  };
}
