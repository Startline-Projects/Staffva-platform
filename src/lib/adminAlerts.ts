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
  /**
   * Dormancy, from `loadDormancyFacts`. Undefined means it was not read —
   * which is not the same as nothing being dormant, so the alerts below stay
   * silent rather than reporting an all-clear nobody checked.
   */
  assignedToDormant?: number;
  dormantSpecialists?: number;
  longestDormancyDays?: number | null;
  unassignedLive?: number;
  awaitingReply?: number;
  awaitingReplyOnDormant?: number;
  longestWaitDays?: number | null;
  neverAnswered?: number;
  /**
   * Checks whose read failed, named for a person ("open disputes"). Every
   * count above arrives as a plain number, so a failed read is
   * indistinguishable from a true zero once it gets here — and for this list a
   * false zero does not show a wrong number, it removes a row. A bell whose
   * dispute check errored would simply not mention disputes.
   */
  failedChecks?: string[];
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

/**
 * How long without a sign-in counts as absent.
 *
 * It lives HERE, in the module with no server-only imports, so that
 * adminPerformance and adminDormancy can both read it. Defining it beside the
 * service-role client instead would have forced a second copy in here — and a
 * page saying "dormant" while the alert beside it stayed quiet is the exact
 * disagreement this whole panel keeps removing.
 */
export const DORMANT_AFTER_DAYS = 30;
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

export function deriveAlerts(d: AlertInput): DerivedAlert[] {
  const list: DerivedAlert[] = [];

  // First, because it qualifies everything under it: an empty list below this
  // row is not an all-clear.
  if (d.failedChecks && d.failedChecks.length > 0) {
    const n = d.failedChecks.length;
    list.push({
      id: "checks-failed",
      priority: "urgent",
      title: `${n} ${plural(n, "check")} could not be read`,
      meta: [
        `Not checked: ${d.failedChecks.join(", ")}`,
        "Anything missing below may be missing because nobody could look, not because it is clear",
      ],
      sla: { text: "Unknown", tone: "critical" },
      actionLabel: "Vendor health",
      href: "/admin/vendors",
      bellHref: "/admin/vendors",
    });
  }

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

  // Someone is being ignored, which outranks any queue depth: the other rows
  // are work nobody has started, this one is a person who already wrote in and
  // has been waiting since.
  if (d.awaitingReply && d.awaitingReply > 0) {
    const n = d.awaitingReply;
    const meta: string[] = [];
    if (d.longestWaitDays) meta.push(`Longest wait ${d.longestWaitDays} days`);
    if (d.neverAnswered) {
      meta.push(`${d.neverAnswered} ${plural(d.neverAnswered, "has", "have")} never had a reply from anyone`);
    }
    if (d.awaitingReplyOnDormant) {
      meta.push(`${d.awaitingReplyOnDormant} waiting on a specialist who is not signing in`);
    }
    list.push({
      id: "awaiting-reply",
      priority: "urgent",
      title: `${n} ${plural(n, "candidate")} ${plural(n, "is", "are")} waiting on a reply`,
      meta: meta.length ? meta : ["Nobody has answered them"],
      sla: { text: "Someone is waiting", tone: "critical" },
      actionLabel: "Answer them",
      href: "/admin/messages",
      bellHref: "/admin/messages",
    });
  }

  // An assignment to an absent specialist is worse than none: the candidate
  // counts as routed everywhere that asks, so no other row here sees them.
  if (d.assignedToDormant && d.assignedToDormant > 0) {
    const n = d.assignedToDormant;
    const who = d.dormantSpecialists ?? 0;
    const meta = [
      who > 0
        ? `Held by ${who} ${plural(who, "specialist")} who ${plural(who, "has", "have")} not signed in for ${DORMANT_AFTER_DAYS}+ days`
        : `Nobody has signed in to work them for ${DORMANT_AFTER_DAYS}+ days`,
      "They count as routed everywhere else, so nothing else flags them",
    ];
    if (d.longestDormancyDays) meta.push(`Longest absence ${d.longestDormancyDays} days`);
    list.push({
      id: "dormant-queues",
      priority: "urgent",
      title: `${n} ${plural(n, "candidate")} ${plural(n, "sits", "sit")} with a specialist who is not signing in`,
      meta,
      sla: { text: "Nobody working them", tone: "critical" },
      actionLabel: "Specialist queues",
      href: "/admin/performance",
      bellHref: "/admin/performance",
    });
  }

  if (d.needsRouting > 0) {
    const n = d.needsRouting;
    list.push({
      id: "routing",
      priority: "urgent",
      // Not "has no specialist" — this counts `assignment_pending_review`,
      // candidates flagged for a routing decision. Someone with no specialist
      // at all is the row below, and conflating the two hid both.
      title: `${n} ${plural(n, "candidate")} ${plural(n, "is", "are")} waiting on a routing decision`,
      meta: ["Flagged for review before their queue is set"],
      sla: { text: "Decision owed", tone: "critical" },
      actionLabel: "Route",
      modal: "route",
      bellHref: "/admin/triage",
    });
  }

  if (d.unassignedLive && d.unassignedLive > 0) {
    const n = d.unassignedLive;
    list.push({
      id: "unassigned-live",
      priority: "today",
      title: `${n} live ${plural(n, "candidate")} ${plural(n, "has", "have")} no talent specialist`,
      meta: ["Visible to clients with nobody owning the relationship"],
      sla: { text: "Unassigned", tone: "warn" },
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
        ? ["A tag on most of the pool is not sorting anything. Most of these were scored before the candidate filled their profile in, or under the old legal-and-accounting-only rubric — both are re-runnable"]
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
