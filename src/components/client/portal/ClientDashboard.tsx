"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * The client dashboard, Atlas steps 5 and 14 — one component, two states,
 * switched on whether the account can fund yet.
 *
 * Everything rendered here is computed by /api/client/dashboard from rows
 * this database holds. What the prototype hard-codes and this does not:
 * "2,847 candidates" (the real pool count is printed, whatever it is), star
 * ratings and review counts for people nobody has reviewed, "% rehire" (no
 * such metric exists), "12% vs Dec" trend arrows (no month to compare
 * against), "Avg approval time", a spend pacing bar against a budget nobody
 * ever set, presence dots, and the "specialist sources 1-2 within 24-48
 * hours" promise the owner's D5 retired outright.
 */

interface Suggestion {
  id: string;
  display_name: string | null;
  country: string | null;
  role_category: string | null;
  hourly_rate: number | null;
  profile_photo_url: string | null;
  availability_status: string | null;
}

interface DashboardData {
  verified: boolean;
  firstName: string;
  hiringFor: string[];
  attention: {
    kind: string;
    title: string;
    detail: string;
    cta: string;
    href: string;
    at: string | null;
    severity: "contract" | "urgent" | "warm" | "calm";
  }[];
  quickStats: { todo: number; inPipeline: number; activeHires: number };
  engagements: {
    id: string;
    name: string;
    role: string | null;
    photo: string | null;
    status: string;
    rate: number | null;
    hours: number | null;
    monthly: number | null;
    startedAt: string | null;
    endsAt: string | null;
  }[];
  spend: { monthlyForecast: number; spentThisMonth: number; heldInEscrow: number };
  recentActivity: { text: string; at: string; href: string }[];
  explore: {
    poolCount: number;
    suggestions: Suggestion[];
    suggestionsAreTargeted: boolean;
    // `saved` is null when the shortlist tables could not be read (migration
    // `client_shortlists` not yet applied) — a different thing from having saved nobody.
    activity: { saved: number | null; conversations: number; upcomingInterviews: number; jobPosts: number };
  };
}

/** Raw enum values must never reach a screen; anything unmapped reads
 *  "Ended", which is true of every remaining engagement status. */
const ENGAGEMENT_LABELS: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  payment_failed: "Payment failed",
  released: "Ended",
  completed: "Completed",
};

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function when(iso: string): string {
  const d = new Date(iso);
  // Floor, not round: rounding called 13 hours ago "yesterday" and 40 hours
  // ago "2 days ago".
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ClientDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/client/dashboard");
        if (cancelled) return;
        if (!res.ok) {
          setFailed(true);
          return;
        }
        setData(await res.json());
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    const t = setTimeout(load, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  // The heading exists in every state. It was the page's only h1, and
  // before this both the loading and failure branches rendered without one —
  // leaving the portal's main page headless exactly when something had gone
  // wrong and the reader most needed to know where they were.
  if (failed) {
    return (
      <section className="cd">
        <header className="cd-welcome">
          <span className="cd-eyebrow">Hiring on StaffVA</span>
          <h1>Dashboard</h1>
        </header>
        <p className="cd-load-error">
          We couldn&apos;t load your dashboard just now. Refresh to try again — the sections below
          still work.
        </p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="cd">
        <header className="cd-welcome">
          <span className="cd-eyebrow">Hiring on StaffVA</span>
          <h1>Dashboard</h1>
        </header>
        <div className="cd-skeleton" role="status" aria-label="Loading your dashboard" />
      </section>
    );
  }

  return (
    <section className="cd">
      <header className="cd-welcome">
        <span className="cd-eyebrow">
          {data.verified ? "Hiring on StaffVA" : "Hiring on StaffVA · Explore"}
        </span>
        <h1>
          {data.verified ? "Welcome back, " : "Welcome to StaffVA, "}
          <em>{data.firstName}</em>.
        </h1>
        <p className="cd-lead">
          {data.verified
            ? data.attention.length > 0
              ? `${data.attention.length} thing${data.attention.length === 1 ? "" : "s"} need your attention.`
              : "Nothing needs your attention right now."
            : "Browse, message and interview freely. Verifying is what lets you move money — you can do it whenever you're ready."}
        </p>
      </header>

      {/* The attention queue is NOT gated on verification. Signing a
          contract, answering a counter and attending an interview are all
          open to an unverified client — the banner says so — so hiding the
          queue behind the verified state meant a client with a contract
          waiting on their signature had no surface anywhere telling them.
          Review caught it. Only the money-shaped rows are things they will
          be asked to verify for, and the gate itself says so at that point. */}
      {!data.verified && data.attention.length > 0 && (
        <section className="cd-section">
          <div className="cd-section-head">
            <h2>Needs your attention</h2>
            <span className="cd-section-meta">Soonest first.</span>
          </div>
          <div className="cd-attention-list">
            {data.attention.map((row, i) => (
              <div className={`cd-attention sev-${row.severity}`} key={`${row.kind}-${i}`}>
                <span className="cd-attention-rail" aria-hidden />
                <div className="cd-attention-body">
                  <div className="cd-attention-title">{row.title}</div>
                  <div className="cd-attention-detail">{row.detail}</div>
                </div>
                <Link href={row.href} className="cd-attention-cta">
                  {row.cta}
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.verified ? (
        <>
          <div className="cd-quickstats">
            <div className="cd-qs">
              <span className={`cd-qs-num${data.quickStats.todo === 0 ? " zero" : ""}`}>
                {data.quickStats.todo}
              </span>
              <span className="cd-qs-label">To do</span>
            </div>
            <div className="cd-qs">
              <span className={`cd-qs-num${data.quickStats.inPipeline === 0 ? " zero" : ""}`}>
                {data.quickStats.inPipeline}
              </span>
              <span className="cd-qs-label">In pipeline</span>
            </div>
            <div className="cd-qs">
              <span className={`cd-qs-num${data.quickStats.activeHires === 0 ? " zero" : ""}`}>
                {data.quickStats.activeHires}
              </span>
              <span className="cd-qs-label">Active hires</span>
            </div>
          </div>

          <section className="cd-section">
            <div className="cd-section-head">
              <h2>Needs your attention</h2>
              <span className="cd-section-meta">Soonest first.</span>
            </div>
            {data.attention.length === 0 ? (
              <p className="cd-empty">
                Nothing waiting on you. New counters, contracts, fundings and approvals appear here.
              </p>
            ) : (
              <div className="cd-attention-list">
                {data.attention.map((row, i) => (
                  <div className={`cd-attention sev-${row.severity}`} key={`${row.kind}-${i}`}>
                    <span className="cd-attention-rail" aria-hidden />
                    <div className="cd-attention-body">
                      <div className="cd-attention-title">{row.title}</div>
                      <div className="cd-attention-detail">{row.detail}</div>
                    </div>
                    <Link href={row.href} className="cd-attention-cta">
                      {row.cta}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="cd-section">
            <div className="cd-section-head">
              <h2>Engagements</h2>
              <Link href="/team#engagements" className="cd-section-link">
                All engagements →
              </Link>
            </div>
            {data.engagements.length === 0 ? (
              <p className="cd-empty">
                Your active engagements live here. Once a contract starts you&apos;ll see its rate,
                hours and approvals at a glance.
              </p>
            ) : (
              <div className="cd-engagements">
                {data.engagements.map((e) => (
                  <div className="cd-engagement" key={e.id}>
                    <div className="cd-engagement-name">{e.name}</div>
                    {e.role && <div className="cd-engagement-role">{e.role}</div>}
                    <span className={`cd-engagement-status st-${e.status}`}>
                      {ENGAGEMENT_LABELS[e.status] ?? "Ended"}
                    </span>
                    <dl className="cd-engagement-terms">
                      {e.rate != null && (
                        <div>
                          <dt>Rate</dt>
                          <dd>${e.rate}/hr</dd>
                        </div>
                      )}
                      {e.hours != null && (
                        <div>
                          <dt>Hours</dt>
                          <dd>{e.hours} hrs/wk</dd>
                        </div>
                      )}
                      {e.monthly != null && (
                        <div>
                          <dt>Monthly</dt>
                          <dd>{money(e.monthly)}</dd>
                        </div>
                      )}
                      {e.startedAt && (
                        <div>
                          <dt>Started</dt>
                          <dd>
                            {new Date(e.startedAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="cd-section">
            <div className="cd-section-head">
              <h2>Spend</h2>
              <Link href="/team#escrow" className="cd-section-link">
                Escrow →
              </Link>
            </div>
            <div className="cd-spend">
              <div className="cd-spend-card primary">
                <span className="cd-spend-label">Monthly, at current terms</span>
                <span className="cd-spend-num">{money(data.spend.monthlyForecast)}</span>
                <span className="cd-spend-meta">
                  {/* Not a forecast of what they WILL spend — the agreed
                      monthly total on active engagements, fee included. */}
                  The agreed monthly total across active engagements, StaffVA&apos;s fee included.
                  Paused engagements are excluded.
                </span>
              </div>
              <div className="cd-spend-card">
                <span className="cd-spend-label">Funded this month</span>
                <span className={`cd-spend-num${data.spend.spentThisMonth === 0 ? " zero" : ""}`}>
                  {money(data.spend.spentThisMonth)}
                </span>
                <span className="cd-spend-meta">Periods and milestones you funded since the 1st.</span>
              </div>
              <div className="cd-spend-card">
                <span className="cd-spend-label">Held in escrow</span>
                <span className={`cd-spend-num${data.spend.heldInEscrow === 0 ? " zero" : ""}`}>
                  {money(data.spend.heldInEscrow)}
                </span>
                <span className="cd-spend-meta">
                  {/* NOT "released when you approve": the auto-release cron
                      pays out periods 48 hours after the period ends and
                      milestones 7 days after they're marked complete,
                      approval or no approval. Saying only the first half
                      would let someone believe money waits for them. */}
                  Funded and not yet released. Released when you approve — or on its own once the
                  release window passes.
                </span>
              </div>
            </div>
          </section>

          {data.recentActivity.length > 0 && (
            <section className="cd-section">
              <div className="cd-section-head">
                <h2>Recent activity</h2>
              </div>
              <ul className="cd-activity-list">
                {data.recentActivity.map((a, i) => (
                  <li key={i}>
                    <Link href={a.href}>
                      <span className="cd-activity-text">{a.text}</span>
                      <span className="cd-activity-time">{when(a.at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <>
          <div className="cd-explore">
            <Link href="/browse" className="cd-explore-card">
              <span className="cd-explore-num">01</span>
              <span className="cd-explore-title">Browse talent</span>
              <span className="cd-explore-sub">
                {/* The count is whatever the pool actually holds — Atlas
                    hard-codes "2,847". The claim after it is exactly what
                    being in that pool guarantees (approved, available); the
                    first draft said "each one interviewed and
                    English-assessed", which the matchable predicate does not
                    promise about every row. */}
                {/* "Open to work" rather than "available right now": the
                    pool excludes people who marked themselves unavailable,
                    but includes those free from a future date. */}
                {data.explore.poolCount === 1
                  ? "1 approved candidate is open to work"
                  : `${data.explore.poolCount} approved candidates are open to work`}
                , with their start dates on their profiles.
              </span>
            </Link>
            <Link href="/post-a-job" className="cd-explore-card">
              <span className="cd-explore-num">02</span>
              <span className="cd-explore-title">Post a role</span>
              <span className="cd-explore-sub">
                {/* The composer drafts with a model and has no hand-write
                    path, so it can be temporarily unavailable. Promising
                    "we'll match candidates to it" as a certainty was a claim
                    a vendor outage could falsify. */}
                Describe what you need and we&apos;ll turn it into a post candidates can find.
              </span>
            </Link>
            <Link href="/verify" className="cd-explore-card">
              <span className="cd-explore-num">03</span>
              <span className="cd-explore-title">Verify when you&apos;re ready</span>
              <span className="cd-explore-sub">
                A government ID and a card. Needed only to fund an engagement — not to hire, message
                or interview.
              </span>
            </Link>
          </div>

          {data.explore.suggestions.length > 0 && (
            <section className="cd-section">
              <div className="cd-section-head">
                <h2>{data.explore.suggestionsAreTargeted ? "Suggested for you" : "Available now"}</h2>
                <span className="cd-section-meta">
                  {data.explore.suggestionsAreTargeted
                    ? `Based on what you said you're hiring for — ${data.hiringFor.join(", ")}`
                    : "A sample of the people you can hire today"}
                </span>
              </div>
              <div className="cd-suggestions">
                {data.explore.suggestions.map((c) => (
                  <Link href={`/candidate/${c.id}`} className="cd-suggestion" key={c.id}>
                    <span className="cd-suggestion-name">{c.display_name || "Candidate"}</span>
                    {c.role_category && (
                      <span className="cd-suggestion-role">{c.role_category}</span>
                    )}
                    <span className="cd-suggestion-meta">
                      {c.hourly_rate != null ? `$${c.hourly_rate}/hr` : ""}
                      {c.country ? `${c.hourly_rate != null ? " · " : ""}${c.country}` : ""}
                    </span>
                  </Link>
                ))}
              </div>
              {/* No count on this link: /browse applies a different
                  availability rule than the matchable pool, so printing a
                  number here would disagree with the one on the page it
                  opens. */}
              <Link href="/browse" className="cd-section-link">
                Browse everyone →
              </Link>
            </section>
          )}

          <section className="cd-section">
            <div className="cd-section-head">
              <h2>Your activity</h2>
            </div>
            <div className="cd-activity-grid">
              {[
                // The Saved card returns with step 8's shortlists: it counts
                // distinct people across the client's real lists and links to
                // a page with a real save control. Omitted entirely — not
                // rendered as 0 — when the count is null, which means the
                // table could not be read rather than that nobody is saved.
                ...(typeof data.explore.activity.saved === "number"
                  ? [{ label: "Saved candidates", n: data.explore.activity.saved, href: "/shortlists" }]
                  : []),
                { label: "Conversations", n: data.explore.activity.conversations, href: "/inbox" },
                {
                  label: "Upcoming interviews",
                  n: data.explore.activity.upcomingInterviews,
                  href: "/team#interviews",
                },
                { label: "Job posts", n: data.explore.activity.jobPosts, href: "/team#roles" },
              ].map((a) => (
                <Link href={a.href} className="cd-activity-card" key={a.label}>
                  <span className={`cd-activity-count${a.n === 0 ? " zero" : ""}`}>{a.n}</span>
                  <span className="cd-activity-label">{a.label}</span>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
