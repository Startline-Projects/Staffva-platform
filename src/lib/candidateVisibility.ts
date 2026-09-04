/**
 * Can clients actually see this candidate, and if not, why not?
 *
 * One predicate, used by the candidate's own dashboard and by anything that
 * describes their state, so the two cannot drift. Today they already have:
 * the dashboard's only visibility notice is an ID banner that is dormant for
 * all 31 live candidates, while the marketplace shows every one of them as
 * "AVAILABLE NOW" — including the three who said they were not.
 *
 * The rule this exists to enforce: never tell someone clients can hire them
 * when something is stopping that, and never tell them they are hidden when
 * browse is showing them. Saying "live" to a person nobody can see is the
 * worst failure this screen has available.
 */

/**
 * How long an availability answer stays trustworthy.
 *
 * Exported so the badge and the dashboard panel agree on what stale means
 * rather than each picking a number. The nudge cron deliberately asks earlier
 * (30 days) so people are prompted before the badge appears — the confirm
 * button is live whether or not the answer has gone stale, so an early nudge
 * never lands on a control the candidate cannot use.
 */
export const STALE_DAYS = 45;

export interface VisibilityInput {
  admin_status?: string | null;
  permanently_blocked?: boolean | null;
  id_verification_status?: string | null;
  id_verification_due_at?: string | null;
  availability_status?: string | null;
  availability_last_updated_at?: string | null;
  created_at?: string | null;
  lock_status?: string | null;
}

export type ReasonKind =
  | "id_overdue"
  | "id_due_soon"
  | "availability_unconfirmed"
  | "not_in_matches"
  | "on_contract"
  | "blocked";

export interface VisibilityReason {
  kind: ReasonKind;
  /** Does this actually stop clients finding them in search? */
  hidesFromSearch: boolean;
  title: string;
  detail: string;
  /** What the candidate can do about it, if anything. */
  action?: { label: string; href: string };
}

export interface Visibility {
  /** Clients can find them by searching or browsing. */
  searchable: boolean;
  /** They appear in the job-matching queries. Narrower than searchable. */
  matchable: boolean;
  reasons: VisibilityReason[];
}

/**
 * Has this availability answer gone stale?
 *
 * Every live candidate's availability_last_updated_at equals their created_at:
 * not one of the 31 has ever revisited the answer they gave on the signup
 * form. So a stale answer means UNKNOWN — it must never be read as a "no".
 * Hiding somebody on the strength of a five-month-old form question they
 * cannot see and have never been able to change would be the same mistake as
 * advertising availability they never claimed, pointed the other way.
 */
export function availabilityIsStale(c: VisibilityInput): boolean {
  const stamp = c.availability_last_updated_at || c.created_at;
  if (!stamp) return true;
  return Date.now() - Date.parse(stamp) > STALE_DAYS * 86_400_000;
}

/**
 * What clients are told about a candidate's availability.
 *
 * Every client-facing surface — the browse grid, the card component, the
 * preview panel — derived this from `committed_hours`, a column that is 0 for
 * all 256 rows and has no writer anywhere in the codebase. So all of them
 * showed "AVAILABLE NOW" for everyone, including the three live candidates
 * whose own answer is not_available. One function now, reading the answer the
 * candidate actually gave, so the four surfaces cannot disagree again.
 */
export type MarketAvailability = "now" | "by_date" | "unavailable";

export function marketAvailability(c: {
  availability_status?: string | null;
  availability_date?: string | null;
}): { kind: MarketAvailability; label: string } {
  if (c.availability_status === "not_available") {
    return { kind: "unavailable", label: "NOT AVAILABLE" };
  }
  if (c.availability_status === "available_by_date") {
    const d = c.availability_date ? new Date(c.availability_date) : null;
    // A lapsed date stays "by date" rather than being promoted to available
    // now. Nothing rolls the column forward — no cron, no generated column —
    // so promoting it here would make the badge the ONLY reader with that
    // rule: browse's "Available now" filter, /api/jobs and /api/match all
    // match on the raw enum, and the card would advertise a candidate the
    // filter beneath it excludes. The display follows the stored value.
    //
    // availability_date is a DATE with no zone, so it is formatted in UTC.
    // Left to the runtime zone, "2026-10-01" renders as Sep 30 for every
    // viewer west of Greenwich — and this page has both a server-rendered
    // and a client-rendered copy, which would then disagree with each other.
    if (d && !Number.isNaN(d.getTime())) {
      return {
        kind: "by_date",
        label: `FROM ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase()}`,
      };
    }
    return { kind: "by_date", label: "AVAILABLE SOON" };
  }
  return { kind: "now", label: "AVAILABLE NOW" };
}

export function computeVisibility(c: VisibilityInput | null | undefined): Visibility {
  const reasons: VisibilityReason[] = [];
  if (!c) return { searchable: false, matchable: false, reasons };

  if (c.permanently_blocked) {
    reasons.push({
      kind: "blocked",
      hidesFromSearch: true,
      title: "Your profile is not visible",
      detail: "This account is closed. Contact support if you think that's wrong.",
    });
    return { searchable: false, matchable: false, reasons };
  }

  const approved = c.admin_status === "approved";

  // The ID window. Dormant for the current cohort — all 31 have passed — but
  // it is the one thing that genuinely removes an approved profile from every
  // client surface, so it stays first.
  const idPassed = c.id_verification_status === "passed";
  const idInReview = c.id_verification_status === "manual_review";
  const due = c.id_verification_due_at ? Date.parse(c.id_verification_due_at) : null;
  const idOverdue = !!due && !idPassed && !idInReview && due < Date.now();
  if (idOverdue) {
    reasons.push({
      kind: "id_overdue",
      hidesFromSearch: true,
      title: "You're hidden from clients",
      detail: "The 14-day ID window has passed. Verify your ID and you're visible again straight away.",
      action: { label: "Verify my ID", href: "/verify-id" },
    });
  } else if (due && !idPassed && !idInReview) {
    const daysLeft = Math.max(0, Math.ceil((due - Date.now()) / 86_400_000));
    reasons.push({
      kind: "id_due_soon",
      hidesFromSearch: false,
      title: `Verify your ID — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`,
      detail: "After that your profile hides from clients until you verify.",
      action: { label: "Verify my ID", href: "/verify-id" },
    });
  }

  // Not available: still searchable, but left out of job matching.
  //
  // WHO SET IT MATTERS. update_candidate_lock_on_engagement() writes
  // not_available when a contract goes active and available_now when it is
  // released — so for a locked candidate this is the platform's own doing, not
  // a choice they made. Two of the three live candidates reading
  // not_available are locked. Telling them "your availability says you're not
  // available" blames them for a state they never chose, and offering an
  // "update" button invites them to put themselves back in the matching pool
  // while under contract, which the next engagement event would overwrite
  // anyway. The on_contract reason below says the true thing instead.
  const notAvailable = c.availability_status === "not_available";
  const onContract = c.lock_status === "locked";
  if (notAvailable && !onContract) {
    reasons.push({
      kind: "not_in_matches",
      hidesFromSearch: false,
      title: "You're not being matched to jobs",
      detail:
        "Your availability says you're not available, so you're left out when clients post work. Your profile is still searchable.",
      action: { label: "Update availability", href: "#availability" },
    });
  } else if (!notAvailable && availabilityIsStale(c)) {
    const stamp = c.availability_last_updated_at || c.created_at;
    reasons.push({
      kind: "availability_unconfirmed",
      hidesFromSearch: false,
      title: "Confirm you're still available",
      detail: stamp
        ? `Clients can find you, but the last we heard about your availability was ${new Date(stamp).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}.`
        : "Clients can find you, but we don't have a recent answer on your availability.",
      action: { label: "Confirm availability", href: "#availability" },
    });
  }

  // On a contract. Stated neutrally — it is a good thing, not a fault — and
  // it now carries the matching consequence, because for a locked candidate
  // this reason has replaced not_in_matches entirely.
  if (onContract) {
    reasons.push({
      kind: "on_contract",
      hidesFromSearch: false,
      title: "You're on an active contract",
      detail: notAvailable
        ? "While the contract runs we keep you out of new job matches. Clients can still find your profile and get in touch about later work — your availability reopens by itself when the contract ends."
        : "Clients can still find you and get in touch about future work.",
    });
  }

  const searchable = approved && !reasons.some((r) => r.hidesFromSearch);
  return {
    searchable,
    matchable: searchable && !notAvailable,
    reasons,
  };
}
