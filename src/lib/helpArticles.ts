/**
 * The Help Center corpus.
 *
 * TWELVE articles, all written. Atlas advertises "60+ articles" and prints
 * "62 articles across 6 categories" over six category cards with hardcoded
 * counts (12/14/11/9/10/6) — behind which sit 12 titles and exactly ONE
 * written body, whose text is keyword stuffing for the demo search. Category
 * landing pages are linked from every card and do not exist.
 *
 * So: no counts that a `.length` cannot produce, and no article that is not
 * written. Every category count on the browse page is computed from this
 * array, which is why it cannot drift from what is actually here.
 *
 * EVERY FACTUAL CLAIM BELOW IS TRACED TO CODE, and the trace is in the
 * `source` field of each article — not a comment, so a claim whose source
 * moves is a claim someone has to come back to. Where the platform's answer
 * is unflattering (the five-day gap when a milestone's dispute window has
 * closed but its money has not moved; the fact that a candidate cannot file
 * their own dispute through the app) the article says so. A help centre that
 * only documents the happy path is where support tickets come from.
 *
 * Deliberately NOT built:
 *  - "Popular this week · what other clients are reading right now" — needs
 *    per-article view analytics. Nothing counts reads.
 *  - The "Was this helpful?" thumbs. Nothing would store the answer; in the
 *    prototype they fire a toast and vanish.
 *  - "All systems normal · status.atlas.work · uptime 99.99%". There is no
 *    status page and nothing measures uptime. The link is dead in Atlas too.
 *  - "Avg reply 1 hr" / "Reply within 4 hours" / "Trust & safety · 24 hrs".
 *    Support response time is not measured, so it is not promised.
 *  - "Ask Alex". Owner decision D5: no talent specialist on the client side.
 */

export type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "note"; text: string };

export interface HelpArticle {
  slug: string;
  title: string;
  category: CategoryKey;
  /** Shown in search results and on category lists. */
  summary: string;
  /** Where in this repository the article's claims can be checked. */
  source: string;
  body: Block[];
}

export type CategoryKey =
  | "money"
  | "hiring"
  | "engagements"
  | "account"
  | "trust";

export const CATEGORIES: { key: CategoryKey; name: string; desc: string }[] = [
  { key: "money", name: "Payments & escrow", desc: "Funding, fees, releases and disputes." },
  { key: "hiring", name: "Hiring", desc: "Browsing, proposals and interviews." },
  { key: "engagements", name: "Contracts & engagements", desc: "Signing, pausing and ending work." },
  { key: "account", name: "Your account", desc: "Verification, security and notifications." },
  { key: "trust", name: "Trust & conduct", desc: "Reviews, messaging rules and what we hold." },
];

export const ARTICLES: HelpArticle[] = [
  // ── Payments & escrow ────────────────────────────────────────────────────
  {
    slug: "how-escrow-works",
    title: "How escrow works",
    category: "money",
    summary: "Money you fund is held by StaffVA and released to your hire — automatically, or by you.",
    source: "src/app/api/escrow/fund, src/app/api/escrow/release, src/app/api/escrow/auto-release",
    body: [
      { kind: "p", text: "Nothing on StaffVA is paid directly from you to the person you hired. Money moves in three steps, and it sits with us in between." },
      { kind: "ol", items: [
        "You fund a pay period or a milestone. Your card is charged then — not later.",
        "The money is held. Your hire can see it is funded, which is the point: they know the work is paid for before they do it.",
        "It is released. Either you release it yourself, or it releases on its own once its clock runs out.",
      ]},
      { kind: "h", text: "The two clocks are different" },
      { kind: "p", text: "This trips people up, so it is worth reading twice. A pay period and a milestone do not behave the same way." },
      { kind: "ul", items: [
        "A funded PAY PERIOD releases 48 hours after the period ends. The window to dispute it closes at the same moment.",
        "A MILESTONE releases 7 days after your hire marks it complete — but the window to dispute it closes after 48 hours.",
      ]},
      { kind: "note", text: "That leaves a five-day stretch on a milestone where the money has not moved yet but the dispute window has already shut. If something is wrong with milestone work, say so within 48 hours of it being marked complete, not within seven days." },
      { kind: "h", text: "\"Releases on its own\" is a scheduled job" },
      { kind: "p", text: "Auto-release runs hourly. So a period whose clock runs out at 2:10pm releases at the next run, not at 2:10pm exactly. It also skips anything with an open dispute — a disputed item never auto-releases, whatever its clock says." },
      { kind: "p", text: "You can always release early from Approvals. Releasing is final: there is no un-release, and the money goes to your hire's payout account." },
    ],
  },
  {
    slug: "what-staffva-charges",
    title: "What StaffVA charges",
    category: "money",
    summary: "10%, added on top of your hire's rate. They receive their full rate.",
    source: "src/lib/escrowMoney.ts (PLATFORM_FEE_RATE), src/app/api/escrow/fund, src/lib/payouts.ts",
    body: [
      { kind: "p", text: "StaffVA charges 10%, and it is added ON TOP of what you agreed to pay. It is not deducted from your hire." },
      { kind: "p", text: "If you agreed $500 for a pay period, you are charged $550 and your hire receives $500. The rate you negotiate is the rate they get." },
      { kind: "h", text: "Where you see it" },
      { kind: "ul", items: [
        "Approvals shows the fee-inclusive figure on the button before you fund anything.",
        "Billing shows what you were charged, and the CSV export breaks out their amount, our fee and your total as separate columns.",
      ]},
      { kind: "note", text: "There is no subscription, no per-seat charge, no posting fee and no charge for browsing, messaging or interviewing. The 10% on released work is the whole of it." },
    ],
  },
  {
    slug: "verify-to-fund",
    title: "Why you need to verify before funding",
    category: "money",
    summary: "Identity and a card on file are required to move money — and only to move money.",
    source: "src/app/api/escrow/fund, src/components/client/portal/VerifyToFund.tsx",
    body: [
      { kind: "p", text: "You can browse, shortlist, message, interview, send proposals and sign a contract without verifying anything. Verification is required at exactly one point: funding escrow." },
      { kind: "p", text: "Two things are needed — an identity check through Stripe, and a card saved to your account. Both live on the Verify page, reachable any time from the sidebar." },
      { kind: "h", text: "Why the gate is there and not earlier" },
      { kind: "p", text: "Escrow means we hold someone's pay and promise them it exists. That promise is only worth something if we know who funded it. Gating earlier would slow down hiring for no gain — nobody's livelihood is on the line while you are reading profiles." },
      { kind: "note", text: "Funding also needs a fully executed contract and an engagement that has not ended. Approvals tells you which of the requirements is unmet, in the order they are checked." },
    ],
  },
  {
    slug: "fund-a-pay-period",
    title: "Funding a pay period",
    category: "money",
    summary: "What has to be true before the Fund button works, and what happens when it does.",
    source: "src/app/api/escrow/fund, src/app/api/client/approvals/route.ts",
    body: [
      { kind: "p", text: "Pay periods appear on Approvals as they come due. Funding one charges your card immediately and puts the money into escrow." },
      { kind: "h", text: "All of these must be true" },
      { kind: "ol", items: [
        "You have verified your identity and have a card on file.",
        "The contract for that engagement is fully executed — signed by both sides.",
        "The engagement has not ended.",
        "The period does not start after the engagement's end date.",
      ]},
      { kind: "h", text: "If you have given notice" },
      { kind: "p", text: "A period that straddles your end date is shortened before it is charged: the dates and the amount are both cut to the part that falls inside the engagement. The figure on Approvals already reflects that, so it is what you pay." },
      { kind: "p", text: "A period that starts entirely after the end date cannot be funded at all." },
      { kind: "note", text: "Pausing is deliberately asymmetric. A period that STARTED before you paused can still be funded — otherwise a pause would leave already-worked time unpaid. New milestones cannot be funded while paused." },
    ],
  },
  {
    slug: "disputes",
    title: "Disputing work",
    category: "money",
    summary: "How to raise a problem, the deadline, and what actually happens next.",
    source: "src/app/api/disputes/file, src/app/api/disputes/resolve",
    body: [
      { kind: "p", text: "If work is not what was agreed, you can dispute the item it was paid under. Filing freezes that money: it stops auto-releasing and cannot be released until the dispute is resolved." },
      { kind: "h", text: "The deadline" },
      { kind: "ul", items: [
        "A pay period: within 48 hours of the period ending.",
        "A milestone: within 48 hours of your hire marking it complete.",
        "Once money has released, the window is closed. Released is final.",
      ]},
      { kind: "h", text: "What happens after you file" },
      { kind: "p", text: "Both you and your hire are notified, and StaffVA reviews it and decides. There is no automatic outcome and no timer — a resolution is a person's decision, and we are not going to promise a turnaround we do not measure." },
      { kind: "note", text: "Being straight about a gap: your hire cannot file their own dispute from the app if you have already filed on the same item. If they disagree with a dispute, they need to tell us — email support@staffva.com and we will treat it as their side of the same case." },
      { kind: "p", text: "Do not file a dispute on something you have not funded. It is not a way to cancel an item you would rather not pay." },
    ],
  },
  {
    slug: "billing-records",
    title: "Your billing records",
    category: "money",
    summary: "What Billing shows, what the CSV contains, and why there are no invoices.",
    source: "src/app/api/client/billing, src/app/api/client/billing/export",
    body: [
      { kind: "p", text: "Billing shows what you have spent, what is currently held in escrow, and what is coming up. Spend counts released money only — funding something moves it into escrow, it does not spend it." },
      { kind: "h", text: "The CSV" },
      { kind: "p", text: "Export gives you one row per released payment: the date, who it went to, what it was for, their amount, our fee and your total. You can export a single month or everything." },
      { kind: "h", text: "There are no invoice PDFs" },
      { kind: "p", text: "We do not issue numbered invoices, because we do not have an invoice record to number — every figure is derived from the payments themselves when you load the page. The CSV is the record, and it is what an accountant actually wants." },
      { kind: "note", text: "Refunded items are excluded from both spend and escrow. Money that came back is not money you paid." },
    ],
  },

  // ── Hiring ───────────────────────────────────────────────────────────────
  {
    slug: "how-matching-works",
    title: "How match scores are calculated",
    category: "hiring",
    summary: "A percentage against your job's own criteria — not a rating of the person.",
    source: "src/lib/jobMatch.ts",
    body: [
      { kind: "p", text: "When you post a job, candidates are scored against the criteria you set on that job. The percentage is points earned over points available FOR THAT JOB, so the same candidate scores differently against two different posts. That is intended." },
      { kind: "h", text: "What it is not" },
      { kind: "ul", items: [
        "It is not a quality score, a vetting score or a rating of the person.",
        "It is not comparable across jobs — a 70% on a demanding post can mean more than a 90% on a loose one.",
      ]},
      { kind: "p", text: "Any criterion we cannot actually check is left out of the total rather than being guessed at, so it neither helps nor hurts the candidate. Every match result can be expanded to show which criteria were met and which were not." },
    ],
  },
  {
    slug: "proposals-and-counters",
    title: "Proposals, counters and rounds",
    category: "hiring",
    summary: "How an offer goes back and forth, and whose turn it is.",
    source: "src/lib/offerTerms.ts, src/app/api/offers",
    body: [
      { kind: "p", text: "A proposal is an offer of specific terms — rate, hours and start date. The candidate can accept it, decline it, or counter." },
      { kind: "p", text: "Each counter is a numbered round, and whose turn it is follows from the round number. The portal shows you whose move it is rather than letting both sides edit at once." },
      { kind: "h", text: "Reading a counter" },
      { kind: "p", text: "A counter shows what changed against the round immediately before it — only against that round, never against an older one, because a diff against something neither of you last saw is misleading." },
      { kind: "note", text: "Candidates cannot start a proposal. Offers begin with you." },
    ],
  },
  {
    slug: "interviews",
    title: "Scheduling and rescheduling interviews",
    category: "hiring",
    summary: "Booking, the join window, and what \"completed\" does and does not mean.",
    source: "src/app/api/interviews, supabase/migrations/*_reschedule_interview.sql",
    body: [
      { kind: "p", text: "Interviews are video calls hosted on the platform. Booking one sends the candidate a calendar invite, and both of you get reminders." },
      { kind: "h", text: "Rescheduling" },
      { kind: "p", text: "Either side can propose a new time while the interview is still booked. What you cannot do is reschedule inside the 15 minutes before it starts — at that point the other person is already waiting, and moving it is indistinguishable from not turning up." },
      { kind: "note", text: "An interview is only marked completed when someone actually joined. The clock passing does not complete an interview, because a meeting nobody attended is not a meeting that happened." },
    ],
  },

  // ── Contracts & engagements ──────────────────────────────────────────────
  {
    slug: "contracts",
    title: "Contracts and signing",
    category: "engagements",
    summary: "Why nothing can be funded until both signatures are in.",
    source: "src/app/api/contracts, src/app/api/escrow/fund",
    body: [
      { kind: "p", text: "A contract sets out the terms you both agreed: rate, hours, notice and how the work ends. It needs a signature from both sides." },
      { kind: "p", text: "Until it is fully executed, escrow cannot be funded on that engagement. This is the most common reason a Fund button refuses — the money is ready and the paperwork is not." },
      { kind: "note", text: "Signing requires being signed in as the party who is signing. A link on its own executes nothing, so a forwarded contract link cannot be used to sign in your place." },
    ],
  },
  {
    slug: "pause-or-end",
    title: "Pausing or ending an engagement",
    category: "engagements",
    summary: "How notice works, what a pause stops, and what it deliberately does not stop.",
    source: "src/app/api/engagements/pause, src/app/api/cron/engagement-notice-complete",
    body: [
      { kind: "p", text: "You can pause an engagement or give notice to end it. Both are on the engagement itself, and both ask for a reason and a date, which your hire sees." },
      { kind: "h", text: "What a pause does" },
      { kind: "ul", items: [
        "New milestones cannot be funded while paused.",
        "A pay period that STARTED before the pause can still be funded. This is deliberate — work already done gets paid for.",
        "Money already in escrow is unaffected. Its clocks keep running and it still releases.",
      ]},
      { kind: "h", text: "Giving notice" },
      { kind: "p", text: "Notice sets an end date. A pay period that crosses that date is shortened to the part before it, and the amount is cut in proportion. Once the date passes the engagement ends on its own." },
      { kind: "note", text: "Ending an engagement does not end anything already funded. Escrow that has been paid in still releases to your hire on its normal clock." },
    ],
  },

  // ── Your account ─────────────────────────────────────────────────────────
  {
    slug: "account-security",
    title: "Securing your account",
    category: "account",
    summary: "Two-factor authentication, backup codes, and what having it on changes.",
    source: "src/app/(main)/account/security, supabase/migrations (mfa_satisfied)",
    body: [
      { kind: "p", text: "Turn on two-factor authentication from Account Settings. It uses an authenticator app — you scan a code once, and after that signing in asks for a six-digit number as well as your password." },
      { kind: "p", text: "Save your backup codes when you are shown them. They are the way back in if you lose the device, and we cannot show them to you again afterwards." },
      { kind: "h", text: "It is enforced in the database, not just the screen" },
      { kind: "p", text: "Once two-factor is on for your account, a session that has not completed the second step is refused at the data layer, not merely redirected by the interface. A stolen password on its own does not reach your engagements, your messages or your money." },
    ],
  },

  // ── Trust & conduct ──────────────────────────────────────────────────────
  {
    slug: "reviews-explained",
    title: "How reviews work",
    category: "trust",
    summary: "Sealed until you have both written one, or 30 days pass — and who can read them.",
    source: "supabase/migrations (my_review_state, submit_review), src/lib/reviewEligibility.ts",
    body: [
      { kind: "p", text: "Reviews open on an engagement once its first payment has been RELEASED. Not when it starts, and not when it ends — so every review on the platform is attached to work that was actually paid for." },
      { kind: "h", text: "The seal" },
      { kind: "ol", items: [
        "Whoever writes first has theirs stored and hidden.",
        "It unseals when the other side submits — or 30 days after the first one was written, whichever comes first.",
        "You can withdraw yours until it unseals. After that, neither side can.",
        "Once the deadline has published a lone review, the other side can no longer write one. A review written after reading theirs would be a reply, not an account.",
      ]},
      { kind: "h", text: "Who can read them" },
      { kind: "p", text: "This is not symmetrical, and you should know which way round it goes. A review you write about a candidate appears on their public profile once it unseals, with your first name attached. A review a candidate writes about you is visible to you and to StaffVA only — there is no public client profile, and candidates browsing the platform cannot read it." },
    ],
  },
  {
    slug: "contact-details-in-messages",
    title: "Why contact details are blocked in messages",
    category: "trust",
    summary: "What the filter catches, why it exists, and when it stops.",
    source: "src/lib/contactMask.ts, src/app/api/messages",
    body: [
      { kind: "p", text: "Before an engagement is under contract, messages that contain email addresses, phone numbers or handles for other platforms are blocked rather than sent." },
      { kind: "h", text: "Why" },
      { kind: "p", text: "Taking the arrangement off-platform is where people get hurt. There is no escrow, no contract and no record of what was agreed, and when someone is not paid there is nothing for us to look at. The filter is inconvenient on purpose." },
      { kind: "note", text: "The filter looks for contact details, not numbers. Ordinary sentences about money and hours go through — a message saying a budget is 1200 is not a phone number, and we fixed it when it was being treated as one. If a legitimate message is blocked, rephrase it or tell us at support@staffva.com." },
    ],
  },
  {
    slug: "what-we-store",
    title: "What we store about your payment method",
    category: "trust",
    summary: "Never the card number. Here is the actual list.",
    source: "src/app/api/client/payment-method, src/app/api/client/billing",
    body: [
      { kind: "p", text: "Your card is held by Stripe. StaffVA never sees and never stores the card number." },
      { kind: "p", text: "What we do store, so we can charge the right card and show you which one it is:" },
      { kind: "ul", items: [
        "A Stripe reference to the card — a token, not the number.",
        "A Stripe customer reference for your account.",
        "The brand, the last four digits and the expiry date.",
        "When the card was added.",
      ]},
      { kind: "note", text: "You can replace the card on file at any time from Verify. There is no way to remove a card without replacing it — if you need the details cleared entirely, email support@staffva.com. Replacing a card does not refund anything already charged and does not stop escrow you have already funded from releasing." },
    ],
  },
];

/** Article counts per category, computed — never a written-down number. */
export function categoryCounts(): Record<CategoryKey, number> {
  const out = {} as Record<CategoryKey, number>;
  for (const c of CATEGORIES) out[c.key] = 0;
  for (const a of ARTICLES) out[a.category] += 1;
  return out;
}

export function articleBySlug(slug: string): HelpArticle | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}

/**
 * Substring search over title, summary and body text.
 *
 * Honest about its own reach: this searches these articles and nothing else,
 * which is why the empty state says so rather than implying a bigger corpus
 * came up short.
 */
export function searchArticles(q: string): HelpArticle[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const hay = (a: HelpArticle) =>
    [
      a.title,
      a.summary,
      ...a.body.map((b) =>
        b.kind === "ul" || b.kind === "ol" ? b.items.join(" ") : b.text
      ),
    ]
      .join(" ")
      .toLowerCase();
  return ARTICLES.filter((a) => hay(a).includes(needle));
}
