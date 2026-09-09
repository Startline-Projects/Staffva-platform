"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import EscrowPaymentModal from "@/components/escrow/EscrowPaymentModal";

type Kind = "period" | "milestone";
type Bucket = "to_fund" | "to_approve" | "in_escrow";

interface Item {
  kind: Kind;
  id: string;
  engagementId: string;
  title: string;
  status: string;
  candidateAmount: number;
  clientCharge: number;
  fundedAt: string | null;
  markedCompleteAt?: string | null;
  autoReleaseAt: string | null;
  disputeClosesAt: string | null;
  disputeFiled: boolean;
  paused: boolean;
  /** Why this cannot be funded right now, or null. Mirrors escrow/fund. */
  fundBlock: string | null;
  /** The period was shortened by notice; amount and end date are the clamped ones. */
  clamped?: boolean;
  candidate: { id?: string; name: string } | null;
}

const money = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** "in 3 days" / "in 5 hours" / "passed" — a deadline is only useful as a distance. */
function until(iso: string, now: number): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "passed";
  const hrs = Math.round(ms / 3_600_000);
  if (hrs < 24) return `in ${hrs} ${hrs === 1 ? "hour" : "hours"}`;
  const days = Math.round(hrs / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * The client's approvals queue.
 *
 * ⚠️ The two clocks are NOT the same and are never shown as one:
 *   - a funded PERIOD auto-releases 48h after the period ends, and the
 *     dispute window closes at that same moment;
 *   - a milestone marked complete auto-releases after 7 DAYS, but disputes
 *     close after 48 HOURS — five days earlier.
 * Step 3's copy already conflated these once and told clients they could
 * dispute until a date that had passed five days before. Each item carries
 * both dates from its own columns.
 *
 * Atlas elements dropped beyond the timesheets, on record:
 *  - the "Approved (8)" history subview and its receipts. Everything here is
 *    forward-looking; released items are filtered out. Step 15's billing
 *    surface owns paid history, and splitting it across two pages would give
 *    the same money two homes.
 *  - the side panel (period card, auto-approval card, escrow totals) — again
 *    step 15's, and all of it derivable there from the same rows.
 *  - the approve toast and the dispute reason chips: the reason chips would
 *    be a taxonomy nothing reads, since the dispute record has one free-text
 *    statement per side.
 *
 * Atlas's version of this screen is timesheets: 23 hours across five days,
 * editable hour cells, "Days worked 5 of 5". D2 rules that out — there is no
 * hour logging on this platform — so none of it is drawn. The Dispute modal
 * IS built: /api/disputes/file has existed with no UI in front of it, which
 * is why zero disputes have ever been filed.
 */
export default function ApprovalsView({
  canFund,
  gateReadable,
}: {
  canFund: boolean;
  gateReadable: boolean;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [signalsOk, setSignalsOk] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [tab, setTab] = useState<Bucket>("to_approve");
  const [busy, setBusy] = useState<string | null>(null);
  const [itemError, setItemError] = useState<{ id: string; message: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // The dispute dialog — the UI /api/disputes/file never had.
  const [disputing, setDisputing] = useState<Item | null>(null);
  const [statement, setStatement] = useState("");
  // Funding is a PaymentIntent + Stripe Elements flow, NOT a redirect.
  // /api/escrow/fund returns { clientSecret, paymentIntentId, amountUsd } and
  // no URL at all — the first draft waited for one, so every click fell
  // through to a silent reload while persisting an abandoned intent on the
  // row. EscrowPaymentModal is the component that already does this properly,
  // including the verify-to-fund refusal and its route.
  const [paying, setPaying] = useState<Item | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/client/approvals");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Could not load your approvals.");
        return;
      }
      const data = await res.json();
      setItems(data.items || []);
      setSignalsOk(data.signalsOk !== false);
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

  // Deadlines are the substance of this page, so they are computed at render
  // from a ticking clock rather than frozen at fetch.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const bucketOf = (i: Item): Bucket =>
    i.status === "pending"
      ? "to_fund"
      : i.kind === "milestone" && i.status === "candidate_marked_complete"
        ? "to_approve"
        : "in_escrow";

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { to_fund: 0, to_approve: 0, in_escrow: 0 };
    for (const i of items) c[bucketOf(i)]++;
    return c;
  }, [items]);

  // Default to whichever bucket actually has something, so the page opens on
  // work rather than on an empty tab.
  useEffect(() => {
    if (loading) return;
    if (counts.to_approve > 0) setTab("to_approve");
    else if (counts.to_fund > 0) setTab("to_fund");
    else if (counts.in_escrow > 0) setTab("in_escrow");
  }, [loading, counts.to_approve, counts.to_fund, counts.in_escrow]);

  const visible = items.filter((i) => bucketOf(i) === tab);

  async function release(item: Item) {
    const key = `${item.kind}:${item.id}`;
    setBusy(key);
    setItemError(null);
    try {
      const res = await fetch("/api/escrow/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId: item.engagementId,
          ...(item.kind === "period" ? { periodId: item.id } : { milestoneId: item.id }),
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setItemError({ id: key, message: b.error || "That didn't work." });
        return;
      }
      await load();
    } catch {
      setItemError({ id: key, message: "Could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  async function fileDispute() {
    if (!disputing) return;
    const key = `${disputing.kind}:${disputing.id}`;
    setBusy(key);
    setItemError(null);
    try {
      const res = await fetch("/api/disputes/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId: disputing.engagementId,
          periodId: disputing.kind === "period" ? disputing.id : undefined,
          milestoneId: disputing.kind === "milestone" ? disputing.id : undefined,
          statement: statement.trim(),
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setItemError({ id: key, message: b.error || "Couldn't file that." });
        return;
      }
      setDisputing(null);
      setStatement("");
      await load();
    } catch {
      setItemError({ id: key, message: "Could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <section className="ap"><p className="ap-lead">Loading…</p></section>;

  if (error) {
    return (
      <section className="ap">
        <h1 className="ap-title">Approvals</h1>
        <p className="ap-error">{error}</p>
      </section>
    );
  }

  const TABS: { key: Bucket; label: string }[] = [
    { key: "to_approve", label: "Waiting on you" },
    { key: "to_fund", label: "To fund" },
    { key: "in_escrow", label: "In escrow" },
  ];

  return (
    <section className="ap">
      <h1 className="ap-title">Approvals</h1>
      <p className="ap-lead">
        {items.length === 0 && !signalsOk
          ? "We couldn't load this queue, so we can't tell you what's waiting."
          : items.length === 0
            ? "Nothing waiting on you. Payment periods and milestones appear here as they come due."
            : "Money decisions waiting on you — what to fund, and what to release."}
      </p>

      {!signalsOk && (
        <p className="ap-error">
          Part of this queue couldn&apos;t load, so something may be missing from it. Reload before
          assuming you&apos;re caught up.
        </p>
      )}

      {truncated && (
        <p className="ap-error">
          This queue is showing a page of your items, not all of them. Don&apos;t treat it as
          &ldquo;caught up&rdquo; until it fits.
        </p>
      )}

      {!canFund && counts.to_fund > 0 && (
        <p className="ap-gate">
          {gateReadable ? (
            <>
              Funding needs your identity verified and a card on file — it&apos;s the only thing
              that needs it. <Link href="/verify">Verify to fund</Link>. Messaging, offers,
              contracts and interviews are unaffected.
            </>
          ) : (
            <>
              We can&apos;t read your verification status right now, so funding may be refused.
              Nothing else is affected.
            </>
          )}
        </p>
      )}

      {items.length === 0 && !signalsOk ? null : items.length === 0 ? (
        <div className="ap-empty">
          <p>Nothing is waiting on you.</p>
          <Link href="/contracts" className="btn btn-outline">Your contracts</Link>
        </div>
      ) : (
        <>
          <div className="ap-tabs" role="tablist" aria-label="Filter approvals">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={`ap-tab${tab === t.key ? " active" : ""}`}
                onClick={() => { setItemError(null); setTab(t.key); }}
              >
                {t.label}
                <span className={`ap-tab-count${counts[t.key] === 0 ? " zero" : ""}`}>{counts[t.key]}</span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <div className="ap-empty"><p>Nothing in this tab.</p></div>
          ) : (
            visible.map((i) => {
              const key = `${i.kind}:${i.id}`;
              // Never on a `pending` item. A fresh period's end date is
              // weeks out, so the window "looked open" on money the client had
              // not paid — and filing flips the row to `disputed`, which
              // removes the Fund button and makes it unpayable from here for
              // good, while booking escrow that was never collected.
              const disputeOpen =
                i.status !== "pending" &&
                !!i.disputeClosesAt &&
                new Date(i.disputeClosesAt).getTime() > now &&
                !i.disputeFiled;
              return (
                <article key={key} className="ap-card">
                  <div className="ap-card-top">
                    <div className="ap-card-id">
                      <div className="ap-card-name">
                        {i.kind === "period" ? "Payment period" : i.title}
                      </div>
                      <div className="ap-card-sub">
                        {i.kind === "period" ? i.title : "Milestone"}
                        {i.candidate ? ` · ${i.candidate.name}` : ""}
                      </div>
                    </div>
                    <div className="ap-card-money">
                      <span className="ap-amount">{money(i.clientCharge)}</span>
                      {/* Derived from the two figures, not asserted: on the
                          legacy cycle engagements clientCharge comes from
                          client_total_usd, which is not always exactly
                          amount_usd + 10%. */}
                      <span className="ap-amount-sub">
                        {money(i.candidateAmount)} to them + {money(Math.round((i.clientCharge - i.candidateAmount) * 100) / 100)} StaffVA fee
                      </span>
                    </div>
                  </div>

                  {i.clamped && !i.fundBlock && (
                    <p className="ap-note">
                      Notice ends this engagement mid-period, so this one is shortened — the dates
                      and amount above are the shortened ones, and that is what would be charged.
                    </p>
                  )}

                  {i.fundBlock && i.status === "pending" && (
                    // The reason, from the same checks escrow/fund runs.
                    // A blanket "paused" note used to explain the two rules
                    // that did NOT apply to the row in front of the reader
                    // and omit the one that did.
                    <p className="ap-note">{i.fundBlock}</p>
                  )}

                  {/* The two clocks, never merged. */}
                  <div className="ap-clocks">
                    {/* Suppressed once disputed: auto-release filters on
                        'funded'/'candidate_marked_complete' and skips anything
                        under an unresolved dispute, so the stored date is no
                        longer a thing that will happen. */}
                    {i.autoReleaseAt && i.status !== "pending" && !i.disputeFiled && i.status !== "disputed" && (
                      <span>
                        Releases on its own {when(i.autoReleaseAt)} ({until(i.autoReleaseAt, now)})
                      </span>
                    )}
                    {(i.disputeFiled || i.status === "disputed") && (
                      <span>Held while StaffVA reviews the dispute — it won&apos;t release on its own.</span>
                    )}
                    {i.disputeClosesAt && i.status !== "pending" && (
                      <span className={disputeOpen ? undefined : "closed"}>
                        {i.disputeFiled
                          ? "A dispute is already on file."
                          : disputeOpen
                            ? `You can dispute until ${when(i.disputeClosesAt)} (${until(i.disputeClosesAt, now)})`
                            : `The window to dispute closed ${when(i.disputeClosesAt)}`}
                      </span>
                    )}
                  </div>

                  <div className="ap-actions">
                    {i.status === "pending" && (
                      <button
                        className="btn btn-primary"
                        disabled={!canFund || !!i.fundBlock}
                        onClick={() => setPaying(i)}
                        title={
                          !canFund
                            ? "Verify your identity and add a card to fund"
                            : i.fundBlock ?? undefined
                        }
                      >
                        {`Fund ${money(i.clientCharge)}`}
                      </button>
                    )}
                    {/* Periods too: escrow/release handles a funded period,
                        and Atlas's primary action is "Approve & release" on
                        exactly that. Withholding a working control would be
                        the dead-control rule in reverse. */}
                    {((i.kind === "milestone" && i.status === "candidate_marked_complete") ||
                      (i.kind === "period" && i.status === "funded")) && (
                      <button
                        className="btn btn-primary"
                        disabled={busy === key}
                        onClick={() => release(i)}
                      >
                        {busy === key ? "Working…" : `Release ${money(i.candidateAmount)}`}
                      </button>
                    )}
                    {disputeOpen && (
                      <button className="btn btn-outline" onClick={() => setDisputing(i)}>
                        Dispute
                      </button>
                    )}
                    {i.candidate?.id && (
                      <Link href={`/messages?candidate=${i.candidate.id}`} className="btn btn-outline">
                        Message
                      </Link>
                    )}
                  </div>
                  {itemError?.id === key && <p className="ap-card-err">{itemError.message}</p>}
                </article>
              );
            })
          )}
        </>
      )}

      {paying && (
        <EscrowPaymentModal
          engagementId={paying.engagementId}
          periodId={paying.kind === "period" ? paying.id : undefined}
          milestoneId={paying.kind === "milestone" ? paying.id : undefined}
          title={paying.kind === "period" ? `Period ${paying.title}` : paying.title}
          onClose={() => setPaying(null)}
          onPaid={() => {
            setPaying(null);
            load();
          }}
        />
      )}

      {disputing && (
        <div className="ct-modal-backdrop" onClick={() => setDisputing(null)}>
          <div
            className="ct-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Dispute this payment"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Dispute this payment?</h2>
            <p className="ct-modal-lead">
              Filing holds the money in escrow while StaffVA reviews it, and{" "}
              {disputing.candidate?.name || "your contractor"} is told it is on hold.
              {/* NOT "and gets to respond": there is no candidate-facing
                  dispute UI, and once you have filed, the duplicate guard
                  blocks them from filing their own — so their side reaches
                  StaffVA only if we ask for it. Promising a two-sided process
                  the product cannot run would be the worst possible place to
                  do it. */}{" "}
              StaffVA may contact them for their side before deciding.
            </p>
            <p className="ct-modal-lead">
              Most problems are quicker to settle in a message first — a dispute is a formal
              review, not a conversation.
            </p>
            <label className="ct-modal-field">
              <span>What happened?</span>
              <textarea
                className="ct-modal-input"
                rows={4}
                maxLength={2000}
                placeholder="What you expected, and what you got."
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
              />
            </label>
            <div className="ct-modal-actions">
              <button className="btn btn-outline" onClick={() => setDisputing(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={!statement.trim() || busy === `${disputing.kind}:${disputing.id}`}
                onClick={fileDispute}
              >
                File dispute
              </button>
            </div>
            {itemError?.id === `${disputing.kind}:${disputing.id}` && (
              <p className="ap-card-err">{itemError.message}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
