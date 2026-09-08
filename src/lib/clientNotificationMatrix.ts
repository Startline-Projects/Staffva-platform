/**
 * Which client-facing events reach the client, and how.
 *
 * The candidate matrix exists because candidate email is frozen, so every
 * suppressed row is a person who is told nothing. The client side has the
 * opposite starting point — client email is NOT frozen and has been sending
 * all along — so the question here is different: does the event also reach
 * them INSIDE the product? Before step 3 the answer was no for every row,
 * and for two of them (a milestone marked complete, a candidate's message
 * reply) there was no channel at all.
 *
 * That milestone row was the sharpest: marking a milestone complete starts a
 * clock that releases the client's money on its own, and the client learned
 * about it only if they happened to reload the dashboard.
 *
 * `bell` is the client_notifications category written at the event site
 * (src/lib/notifyClient.ts), or null where the event has no bell yet and the
 * `note` says why. `inApp` is a route where the client can see the fact for
 * themselves. scripts/verify-notifications.mts reads the codebase for every
 * `recipientKind: "client"` send and fails if one is missing here, so a new
 * client email cannot be added without a decision about the in-app half.
 */

export interface ClientNotificationRow {
  /** emailType, exactly as passed to sendEmail/enqueueEmail. */
  type: string;
  /** What happened. */
  event: string;
  /** client_notifications category written at the site, or null. */
  bell: string | null;
  /** Route where the client can see this for themselves. */
  inApp: string | null;
  note?: string;
}

export const CLIENT_NOTIFICATIONS: readonly ClientNotificationRow[] = [
  // ── Proposals ─────────────────────────────────────────────────────────────
  {
    type: "offer_response",
    event: "A candidate accepted or declined a proposal",
    bell: "contract / offer",
    inApp: "/team#offers",
    note:
      "Two sites, two categories on purpose: an ACCEPT writes a 'contract' bell (the next " +
      "thing that happens is a signature), a DECLINE writes an 'offer' bell.",
  },
  {
    type: "offer_counter",
    event: "A candidate countered the terms",
    bell: "offer",
    inApp: "/team#offers",
    note: "Resets a 5-day expiry, so the bell carries the deadline in its body.",
  },
  {
    type: "offer_expired",
    event: "A sent offer expired unanswered",
    bell: null,
    inApp: "/team#offers",
    note:
      "Cron-driven; the offer row's own status says 'expired' on the dashboard. A bell for " +
      "'nothing happened' is noise — revisit if clients report being surprised by it.",
  },

  // ── Contracts ─────────────────────────────────────────────────────────────
  {
    type: "contract_executed",
    event: "The candidate countersigned; the agreement is executed",
    bell: "contract",
    inApp: "/team#engagements",
    note:
      "The bell is written at the SIGNING site, not the email's site: the email comes from " +
      "generate-pdf, reached by an internal fetch behind CRON_SECRET that can fail.",
  },

  // ── Money ─────────────────────────────────────────────────────────────────
  {
    type: "milestone_marked_complete",
    event: "A candidate marked a milestone complete, starting the 7-day auto-release clock",
    bell: "payment",
    inApp: "/team#engagements",
    note:
      "NEW in client step 3 — both channels. Before it, the strongest single gap on this " +
      "side: money released itself on a timer the client was never told had started. " +
      "AUTO-RELEASE IS 7 DAYS; the 48-hour figure nearby is the separate dispute window, and " +
      "the copy names neither a dispute nor that deadline because NO dispute control exists " +
      "in the client product (only an admin resolve screen) — see the open-gaps list below.",
  },

  // ── Engagements ───────────────────────────────────────────────────────────
  {
    type: "engagement_notice",
    event: "The candidate gave 14 days' notice",
    bell: "engagement",
    inApp: "/team#engagements",
  },
  {
    type: "engagement_paused",
    event: "The candidate paused the engagement",
    bell: "engagement",
    inApp: "/team#engagements",
  },
  {
    type: "engagement_resumed",
    event: "The candidate resumed the engagement",
    bell: "engagement",
    inApp: "/team#engagements",
  },
  {
    type: "engagement_notice_complete",
    event: "The notice period ran out, OR a 30-day pause auto-terminated the engagement",
    bell: null,
    inApp: "/team#engagements",
    note:
      "GAP, narrowed but not closed. For a notice-out the client already got the notice bell " +
      "14 days earlier carrying the end date. The same cron also completes PAUSE-OUTS (cause " +
      "= 'pause'), where no notice was ever given and no earlier bell exists — those clients " +
      "get the email only. Closing it means a bell in the cron; it belongs with the " +
      "engagements surface work.",
  },

  // ── Interviews ────────────────────────────────────────────────────────────
  {
    type: "interview_booked",
    event: "An interview was booked",
    bell: null,
    inApp: "/team#interviews",
    note:
      "The client is the one who books, so a bell would announce their own click back to " +
      "them. The confirmation email carries the calendar invite.",
  },
  {
    type: "interview_cancelled",
    event: "An interview was cancelled",
    bell: "interview",
    inApp: "/team#interviews",
    note:
      "Bell written only when the CANDIDATE cancelled — the same rule as booking: no bell " +
      "for the client's own action.",
  },
  {
    type: "interview_reminder",
    event: "An interview is coming up",
    bell: null,
    inApp: "/team#interviews",
    note:
      "Time-based nudge, and the dashboard's Interviews section shows the schedule. A bell " +
      "that fires on a timer for something already on screen is noise.",
  },
  {
    type: "interview_request_confirmed",
    event: "A paid interview request was confirmed",
    bell: null,
    inApp: null,
    note:
      "Dead path: interview purchasing was discontinued (/api/interviews/checkout returns " +
      "410). The webhook branch survives for historical Stripe events only.",
  },

  // ── Messages ──────────────────────────────────────────────────────────────
  {
    type: "(no email)",
    event: "A candidate replied to a message",
    bell: "message",
    inApp: "/inbox",
    note:
      "NEW in client step 3, bell only. One per thread per day, enforced by the dedupe " +
      "index. No candidate-typed text in the body — the bell is a trusted surface, and the " +
      "thread itself shows who wrote what.",
  },
];

/**
 * Client-facing events that reach the client through NOTHING — no email, no
 * bell — and so are not rows above (there is no email type to hang them on).
 * Written down by the step-3 review rather than left to be rediscovered;
 * each names the file that would carry the call.
 */
export const CLIENT_COVERAGE_GAPS: readonly { event: string; where: string; step?: string }[] = [
  {
    event: "Escrow auto-released a milestone or period — the money actually moved",
    where: "src/app/api/escrow/auto-release/route.ts",
    step: "The bell promises the release; nothing confirms it happened. Also note the whole " +
      "promise depends on CRON_SECRET being set — hasCronSecret() fails closed, so an unset " +
      "var means the cron 401s hourly and no release ever fires, silently.",
  },
  {
    event: "An escrow payment failed; the engagement is now status 'payment_failed'",
    where: "src/app/api/stripe/webhook/route.ts (payment_intent.payment_failed)",
    step: "The candidate keeps working against an unfunded period with nobody told.",
  },
  {
    event: "A charge was refunded",
    where: "src/app/api/stripe/webhook/route.ts (charge.refunded)",
  },
  {
    event: "A dispute was filed, or an admin resolved one (which can move money)",
    where: "src/app/api/disputes/file/route.ts, src/app/api/disputes/resolve/route.ts",
    step: "Bigger than a notification: there is no dispute control in the CLIENT product at " +
      "all — /api/disputes/file has no caller outside its own docstring, and the only screen " +
      "is the admin resolve view. Belongs with the approvals surface.",
  },
  {
    event: "A candidate's review of the client was revealed",
    where: "src/app/api/reviews/route.ts",
    step: "'review' is not even a valid client_notifications category yet (00220) — adding it " +
      "is part of the reviews surface work.",
  },
];

/** Client events that reach the client through no bell at all. */
export function clientSilentEvents(): ClientNotificationRow[] {
  return CLIENT_NOTIFICATIONS.filter((r) => r.bell === null);
}

/** Email types the matrix accounts for (excluding the bell-only pseudo-row). */
export function clientKnownTypes(): Set<string> {
  return new Set(CLIENT_NOTIFICATIONS.map((r) => r.type).filter((t) => t !== "(no email)"));
}
