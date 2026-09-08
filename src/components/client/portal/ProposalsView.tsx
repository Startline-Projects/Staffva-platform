"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NegotiationPanel from "@/components/offers/NegotiationPanel";
import type { ProposalBucket, TermsDiff } from "@/lib/offerTerms";

interface HistoryRound {
  round: number;
  proposedBy: "client" | "candidate";
  hourlyRate: number;
  hoursPerWeek: number;
  contractLength: string;
  startDate: string;
  message: string | null;
  createdAt: string;
}

interface Proposal {
  id: string;
  status: string;
  currentRound: number;
  turn: "client" | "candidate";
  bucket: ProposalBucket;
  terms: { hourly_rate: number; hours_per_week: number; contract_length: string; start_date: string };
  diff: TermsDiff;
  money: { candidateWeekly: number; clientMonthly: number; feeMonthly: number };
  signingBonusUsd: number | null;
  personalMessage: string | null;
  createdAt: string;
  sentAt: string | null;
  respondedAt: string | null;
  expiresAt: string | null;
  historyGap: boolean;
  history: HistoryRound[];
  candidate: {
    id: string;
    withdrawn: string | null;
    displayName: string;
    country: string | null;
    roleCategory: string | null;
    photo: string | null;
  } | null;
}

const TABS: { key: ProposalBucket | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "awaiting_you", label: "Your move" },
  { key: "awaiting_them", label: "Awaiting them" },
  { key: "accepted", label: "Accepted" },
  { key: "closed", label: "Closed" },
];

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * A DATE column (start_date) has no time or zone: parsed as UTC midnight it
 * prints a day early anywhere west of UTC, so "2026-10-01" would render
 * "Sep 30". Pinned to UTC, matching offers/route.ts and acceptOffer.ts.
 */
const dateOnly = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });

/** A timestamptz — the viewer's own zone is the right one here. */
const stamp = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * The proposals page body.
 *
 * What Atlas has here and this does not, all deliberate:
 *  - A "Received" tab. D3 rules out candidate-initiated proposals, so every
 *    row is one this client sent; the tabs split on whose move it is.
 *  - A verify wall on sending. D1 gates escrow FUNDING only, so sending stays
 *    open to an unverified client and there is nothing to lock.
 *  - Rehire %, star ratings and "Atlas takes 8% from candidate". The first two
 *    have no backing; the third is both the wrong number and the wrong
 *    direction — our fee is 10% ON TOP of what the candidate earns.
 */
export default function ProposalsView() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [historyOk, setHistoryOk] = useState(true);
  const [tab, setTab] = useState<ProposalBucket | "all">("all");
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [cardError, setCardError] = useState<{ id: string; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/client/proposals");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Could not load your proposals.");
        return;
      }
      const data = await res.json();
      setProposals(data.proposals || []);
      setHistoryOk(data.historyOk !== false);
      setTruncated(data.truncated === true);
      setError("");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Accept or decline the candidate's counter. This is the action the page
   * exists for, and the first draft did not have it: cards linked to
   * /offers/[id], which is the CANDIDATE's response surface — it hard-codes
   * viewer="candidate", so it hid the counter form exactly when it was the
   * client's turn, inverted the round labels, called the client "A client",
   * and its Accept button 404s for anyone without a candidates row. Worse,
   * merely loading it fired mark_viewed and stamped the candidate as having
   * opened an offer they had not seen.
   */
  async function respond(offerId: string, response: "accept" | "decline") {
    if (
      response === "accept" &&
      !confirm("Accept the candidate's counter? A contract will be drawn up at their proposed terms.")
    ) return;
    setBusy(offerId);
    setCardError(null);
    try {
      const res = await fetch("/api/offers/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "respond", offerId, response }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCardError({ id: offerId, message: body.error || "Couldn't respond — try again." });
        return;
      }
      await load();
    } catch {
      setCardError({ id: offerId, message: "Could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: proposals.length, awaiting_you: 0, awaiting_them: 0, accepted: 0, closed: 0 };
    for (const p of proposals) c[p.bucket] = (c[p.bucket] || 0) + 1;
    return c;
  }, [proposals]);

  // What the client would pay each month if every OPEN proposal were accepted
  // as it currently stands. Accepted ones are excluded — they are already
  // committed, and counting them would answer a different question than the
  // heading asks. Atlas's equivalent card contradicts its own breakdown.
  const openSpend = useMemo(
    () =>
      proposals
        // A draft was never sent, so it cannot be accepted and must not be
        // counted as an open proposal. (Unreachable today — the send path
        // always inserts 'sent' — but 'draft' is the column default.)
        .filter((p) => p.status !== "draft" && (p.bucket === "awaiting_you" || p.bucket === "awaiting_them"))
        .reduce((n, p) => n + p.money.clientMonthly, 0),
    [proposals]
  );

  const openCount = proposals.filter(
    (p) => p.status !== "draft" && (p.bucket === "awaiting_you" || p.bucket === "awaiting_them")
  ).length;
  const visible = tab === "all" ? proposals : proposals.filter((p) => p.bucket === tab);

  if (loading) return <section className="pr"><p className="pr-lead">Loading your proposals…</p></section>;

  if (error) {
    return (
      <section className="pr">
        <h1 className="pr-title">Your proposals</h1>
        <p className="pr-error">{error}</p>
        <p className="pr-lead">Nothing has been lost — this is a loading problem.</p>
      </section>
    );
  }

  return (
    <section className="pr">
      <h1 className="pr-title">Your proposals</h1>
      <p className="pr-lead">
        {proposals.length === 0
          ? "You haven't sent a proposal yet."
          : "Every offer you've sent, where each one stands, and what it would cost you."}
      </p>

      {truncated && (
        <p className="pr-error">
          Showing your most recent 200 proposals. The totals below cover only those.
        </p>
      )}

      {!historyOk && (
        <p className="pr-error">
          We couldn&apos;t load the negotiation history just now, so cards may show only their
          current terms. The terms themselves are correct.
        </p>
      )}

      {proposals.length === 0 ? (
        <div className="pr-empty">
          <p>Proposals you send to candidates show up here, with every round of negotiation.</p>
          <Link href="/browse" className="btn btn-primary">Browse candidates</Link>
        </div>
      ) : (
        <>
          <div className="pr-body">
            <div className="pr-main">
              <div className="pr-tabs" role="tablist" aria-label="Filter proposals">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={tab === t.key}
                    className={`pr-tab${tab === t.key ? " active" : ""}`}
                    onClick={() => setTab(t.key)}
                  >
                    {t.label}
                    <span className={`pr-tab-count${(counts[t.key] ?? 0) === 0 ? " zero" : ""}`}>
                      {counts[t.key] ?? 0}
                    </span>
                  </button>
                ))}
              </div>

              {visible.length === 0 ? (
                <div className="pr-empty"><p>Nothing in this tab.</p></div>
              ) : (
                visible.map((p) => {
                  const yours = p.bucket === "awaiting_you";
                  const canRespond = yours && p.status === "countered";
                  const gone = p.candidate?.withdrawn ?? null;
                  const expires = p.expiresAt ? new Date(p.expiresAt) : null;
                  return (
                    <article key={p.id} className={`pr-card${yours ? " yours" : ""}${gone ? " gone" : ""}`}>
                      <div className="pr-card-top">
                        <div
                          className="pr-avatar"
                          style={!gone && p.candidate?.photo ? { backgroundImage: `url("${encodeURI(p.candidate.photo)}")` } : undefined}
                          aria-hidden
                        >
                          {(gone || !p.candidate?.photo) && (p.candidate?.displayName?.[0] || "?").toUpperCase()}
                        </div>
                        <div className="pr-card-id">
                          <div className="pr-card-name">{p.candidate?.displayName || "Candidate"}</div>
                          {gone ? (
                            <div className="pr-card-gone">{gone}</div>
                          ) : (
                            <div className="pr-card-sub">
                              {[p.candidate?.roleCategory, p.candidate?.country].filter(Boolean).join(" · ")}
                            </div>
                          )}
                        </div>
                        <span className={`pr-status st-${p.bucket}`}>
                          {p.bucket === "awaiting_you"
                            ? p.status === "draft" ? "Draft — not sent" : "Your move"
                            : p.bucket === "awaiting_them"
                              ? "Awaiting them"
                              : p.bucket === "accepted"
                                ? "Accepted"
                                : p.status === "expired" ? "Expired" : "Declined"}
                        </span>
                      </div>

                      <div className="pr-terms">
                        <Term label="Rate" value={`$${p.terms.hourly_rate}/hr`} change={p.diff.hourly_rate} suffix="/hr" prefix="$" />
                        <Term label="Hours" value={`${p.terms.hours_per_week}/wk`} change={p.diff.hours_per_week} suffix="/wk" />
                        <Term label="Length" value={p.terms.contract_length} change={p.diff.contract_length} />
                        <Term label="Starts" value={dateOnly(p.terms.start_date)} change={p.diff.start_date} formatted={dateOnly} />
                      </div>

                      <div className="pr-total">
                        <span className="pr-total-num">{money(p.money.clientMonthly)}<span>/mo</span></span>
                        {/* The direction matters: our 10% is charged ON TOP of
                            what the candidate earns, so this is the client's
                            full cost — not a cut taken from the candidate. */}
                        <span className="pr-total-note">
                          {p.terms.hours_per_week} hrs/wk at ${p.terms.hourly_rate}/hr plus StaffVA&apos;s
                          10% ({money(p.money.feeMonthly)}), estimated on 4.33 weeks a month.
                          {p.signingBonusUsd
                            ? ` A one-off ${money(p.signingBonusUsd)} signing bonus is on top of this monthly figure.`
                            : ""}
                        </span>
                      </div>

                      {p.personalMessage && (
                        // The client's own note, shown back to them — it is
                        // part of what an accept would bind.
                        <p className="pr-note">“{p.personalMessage}” <span>— your note</span></p>
                      )}

                      <div className="pr-meta">
                        {p.sentAt && <span>Sent {stamp(p.sentAt)}</span>}
                        {expires && (
                          // Real, not decorative: expire-offers flips these
                          // daily at sent_at + 5 days, and each counter resets
                          // the clock.
                          <span className={expires.getTime() - Date.now() < 48 * 3600 * 1000 ? "soon" : undefined}>
                            Lapses {stamp(p.expiresAt!)} if nobody replies
                          </span>
                        )}
                        {p.respondedAt && p.bucket !== "awaiting_them" && <span>Answered {stamp(p.respondedAt)}</span>}
                      </div>

                      {p.historyGap && (
                        <p className="pr-history-note">
                          A round of this negotiation wasn&apos;t recorded, so the history below is
                          incomplete and no &ldquo;was&rdquo; is shown against the terms.
                        </p>
                      )}

                      {/* The existing negotiation component, with viewer="client":
                          it renders the round history AND the counter form, and
                          hides the form off-turn. Reused rather than rebuilt so
                          the two surfaces cannot drift — and because its round
                          labels are only correct when the viewer is passed
                          honestly. */}
                      {["sent", "viewed", "countered"].includes(p.status) && (
                        <NegotiationPanel
                          offerId={p.id}
                          viewer="client"
                          currentTerms={{
                            hourly_rate: p.terms.hourly_rate,
                            hours_per_week: p.terms.hours_per_week,
                            contract_length: p.terms.contract_length,
                            start_date: p.terms.start_date,
                          }}
                          signingBonus={p.signingBonusUsd}
                          onChanged={load}
                        />
                      )}

                      <div className="pr-actions">
                        {canRespond && (
                          <>
                            <button className="btn btn-primary" disabled={busy === p.id} onClick={() => respond(p.id, "accept")}>
                              {busy === p.id ? "Working…" : "Accept counter"}
                            </button>
                            <button className="btn btn-outline" disabled={busy === p.id} onClick={() => respond(p.id, "decline")}>
                              Decline
                            </button>
                          </>
                        )}
                        {p.bucket === "accepted" && (
                          <Link href="/team#engagements" className="btn btn-primary">View engagement</Link>
                        )}
                        {p.candidate && !gone && (
                          <>
                            <Link href={`/inbox?candidate=${p.candidate.id}`} className="btn btn-outline">Message</Link>
                            <Link href={`/candidate/${p.candidate.id}`} className="btn btn-outline">View profile</Link>
                          </>
                        )}
                      </div>
                      {cardError?.id === p.id && <p className="pr-card-err">{cardError.message}</p>}
                    </article>
                  );
                })
              )}
            </div>

            <aside className="pr-side">
              <div className="pr-side-card">
                <h2>Where they stand</h2>
                <div className="pr-side-rows">
                  <div><span>Your move</span><span>{counts.awaiting_you ?? 0}</span></div>
                  <div><span>Awaiting them</span><span>{counts.awaiting_them ?? 0}</span></div>
                  <div><span>Accepted</span><span>{counts.accepted ?? 0}</span></div>
                  <div><span>Closed</span><span>{counts.closed ?? 0}</span></div>
                </div>
              </div>
              <div className="pr-side-card spend">
                <h2>If every open proposal is accepted</h2>
                <div className="pr-spend-num">{money(openSpend)}<span>/mo</span></div>
                <p className="pr-spend-note">
                  {openCount} open {openCount === 1 ? "proposal" : "proposals"} at their current terms,
                  fee included. Accepted ones aren&apos;t counted — they&apos;re committed, not pending.
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

/** One term, with a strike-through only when an earlier round was stored. */
function Term({
  label,
  value,
  change,
  prefix = "",
  suffix = "",
  formatted,
}: {
  label: string;
  value: string;
  change: { previous: string | number | null; direction: "up" | "down" | "same" };
  prefix?: string;
  suffix?: string;
  formatted?: (v: string) => string;
}) {
  const prev = change.previous;
  return (
    <div className="pr-term">
      <span className="pr-term-label">{label}</span>
      <span className={`pr-term-value${prev !== null ? ` changed-${change.direction}` : ""}`}>
        {prev !== null && (
          <span className="pr-term-was">
            {formatted && typeof prev === "string" ? formatted(prev) : `${prefix}${prev}${suffix}`}
          </span>
        )}
        {value}
      </span>
    </div>
  );
}
