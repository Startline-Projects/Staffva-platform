"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Upcoming {
  id: string;
  kind: string;
  label: string;
  due: string | null;
  amount: number;
  who: string | null;
}
interface Activity {
  at: string;
  kind: string;
  label: string;
  who: string | null;
  amount: number;
}
interface Statement {
  month: string;
  payments: number;
  total: number;
}
interface Billing {
  spend: { thisMonth: number; lifetime: number; sinceIso: string | null };
  escrowHeld: number;
  upcoming: Upcoming[];
  activity: Activity[];
  statements: Statement[];
  card: { brand: string | null; last4: string | null; exp: string | null } | null;
  truncated?: boolean;
  cardReadable: boolean;
  signalsOk: boolean;
}

const money = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
  });

/**
 * The client's billing page.
 *
 * Every figure is derived at read time from the escrow rows. Atlas's version
 * carries things this deliberately does not:
 *  - INV-2025-0124-ML invoice ids and per-invoice PDFs. There is no invoice
 *    entity and no document of record to render; the CSV export below is the
 *    honest version of "hand it to your accountant".
 *  - A "12% vs Dec" trend. That needs a comparable prior month, and no client
 *    has spent anything yet.
 *  - "Add accountant", and the 12wk/6mo/All-time chart toggles, which have no
 *    handlers in the prototype either.
 *  - The whole Invoices TAB. Its rows are payments, which is what Activity
 *    below already lists from the same rows — a second table of one fact,
 *    keyed by an id scheme that does not exist.
 *  - Edit/Remove on the payment method (both handler-less in Atlas). Replace
 *    goes through /verify, which is where the card is actually set.
 *  - The 12-week spend chart. This one IS derivable — every release carries a
 *    date and an amount — and it is a deliberate deferral rather than a
 *    fiction: no client has released anything yet, so it would draw twelve
 *    empty columns. Worth building the moment there is a second month of
 *    data to compare.
 *  - "Atlas takes 8% from the candidate". Ours is 10%, charged ON TOP of what
 *    the candidate earns — a different number in the opposite direction.
 *
 * The zero states are written for a platform where nothing has been funded
 * yet, which is the true state today: "$0 so far" must read as a fact, not as
 * a page that failed to load.
 */
export default function BillingView() {
  const [data, setData] = useState<Billing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/client/billing");
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error || "Could not load your billing.");
        return;
      }
      setData(await res.json());
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

  if (loading) return <section className="bl"><p className="bl-lead">Loading…</p></section>;
  if (error || !data) {
    return (
      <section className="bl">
        <h1 className="bl-title">Billing</h1>
        <p className="bl-error">{error || "Could not load your billing."}</p>
      </section>
    );
  }

  // Gated on signalsOk: with a failed read every total is 0 too, and the
  // unconditional version rendered "these are all zero — not an error"
  // directly under a banner saying the totals were incomplete. The confident
  // sentence was the false one. (Third time this trap has appeared here.)
  const loadedFully = data.signalsOk && !data.truncated;
  const nothingYet = loadedFully && data.spend.lifetime === 0 && data.escrowHeld === 0;

  return (
    <section className="bl">
      <div className="bl-head">
        <div>
          <h1 className="bl-title">Billing</h1>
          <p className="bl-lead">
            Everything you&apos;ve paid, everything held in escrow, and what&apos;s next.
          </p>
        </div>
        {data.statements.length > 0 && (
          <a href="/api/client/billing/export" className="btn btn-outline">Export CSV</a>
        )}
      </div>

      {data.truncated && (
        <p className="bl-error">
          You have more payments than this page can total in one go, so these figures cover only
          the most recent ones. The monthly CSVs below are the reliable record.
        </p>
      )}

      {!data.signalsOk && (
        <p className="bl-error">
          Part of your billing couldn&apos;t load, so these totals may be incomplete. Reload before
          relying on them.
        </p>
      )}

      <div className="bl-stats">
        <div className="bl-stat primary">
          <span className="bl-stat-label">Spent this month</span>
          <span className="bl-stat-num">{money(data.spend.thisMonth)}</span>
          <span className="bl-stat-meta">
            {/* A period is only "spent" once it has actually released. */}
            {!loadedFully
              ? "May be incomplete"
              : data.spend.thisMonth === 0
                ? "Nothing released this month"
                : "Released from escrow"}
          </span>
        </div>
        <div className="bl-stat">
          <span className="bl-stat-label">Held in escrow</span>
          <span className="bl-stat-num">{money(data.escrowHeld)}</span>
          <span className="bl-stat-meta">
            {/* "waiting to release" would overclaim: this bucket includes
                disputed money, which is held precisely because it may NOT
                release. */}
            {!loadedFully
              ? "May be incomplete"
              : data.escrowHeld === 0
                ? "Nothing funded right now"
                : "Funded and not yet released"}
          </span>
        </div>
        <div className="bl-stat">
          <span className="bl-stat-label">Paid all time</span>
          <span className="bl-stat-num">{money(data.spend.lifetime)}</span>
          <span className="bl-stat-meta">
            {!loadedFully
              ? "May be incomplete"
              : data.spend.sinceIso
                ? `Since ${day(data.spend.sinceIso)}`
                : "No payments yet"}
          </span>
        </div>
      </div>

      {nothingYet && (
        <p className="bl-note">
          Nothing has been funded on your account yet, so these are all zero — not an error. Money
          moves when you fund a payment period or a milestone from{" "}
          <Link href="/approvals">Approvals</Link>.
        </p>
      )}

      <div className="bl-cols">
        <div>
          <h2 className="bl-h2">Not funded yet</h2>
          {data.upcoming.length === 0 ? (
            <p className="bl-empty">
              {loadedFully
                ? "Nothing waiting to be funded."
                : "We couldn't read your upcoming charges just now."}
            </p>
          ) : (
            <ul className="bl-list">
              {data.upcoming.map((u) => (
                <li key={`${u.kind}:${u.id}`}>
                  <span className="bl-list-main">
                    <strong>{u.label}</strong>
                    <span>{u.who}{u.due ? ` · period ends ${u.due}` : ""}</span>
                  </span>
                  <span className="bl-list-amt">{money(u.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {data.upcoming.length > 0 && (
            <p className="bl-note">
              Nothing here is charged yet. Funding is a decision you make on{" "}
              <Link href="/approvals">Approvals</Link>, which also checks whether each one can be
              funded right now — a signed contract and an active engagement are both required.
            </p>
          )}

          <h2 className="bl-h2">Activity</h2>
          {data.activity.length === 0 ? (
            <p className="bl-empty">
              {loadedFully ? "No payments yet." : "We couldn't read your payment history just now."}
            </p>
          ) : (
            <ul className="bl-list">
              {data.activity.map((a, n) => (
                <li key={`${a.kind}:${a.at}:${n}`}>
                  <span className="bl-list-main">
                    <strong>
                      {a.kind === "released"
                        ? "Released"
                        : a.kind === "refunded"
                          ? "Refunded to you"
                          : "Funded into escrow"} · {a.label}
                    </strong>
                    <span>{a.who} · {day(a.at)}</span>
                  </span>
                  <span className="bl-list-amt">{money(a.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="bl-side">
          <div className="bl-card">
            <h2>Payment method</h2>
            {!data.cardReadable ? (
              <p className="bl-empty">We can&apos;t read your card details right now.</p>
            ) : data.card ? (
              <>
                <p className="bl-method">
                  {data.card.brand ? `${data.card.brand} ` : "Card "}ending {data.card.last4}
                  {data.card.exp ? ` · expires ${data.card.exp}` : ""}
                </p>
                <Link href="/verify" className="btn btn-outline">Replace card</Link>
              </>
            ) : (
              <>
                <p className="bl-empty">No card on file.</p>
                <Link href="/verify" className="btn btn-primary">Add a card</Link>
              </>
            )}
            <p className="bl-trust">
              {/* Precisely what is stored. The first draft said "only the
                  brand, last four and expiry", which was false — the Stripe
                  payment-method token is stored too. Never the card number. */}
              Your card lives at Stripe. StaffVA never sees or stores the card number — only a
              Stripe reference to it, plus the brand, last four digits and expiry so you can tell
              which card it is.
            </p>
          </div>

          <div className="bl-card">
            <h2>Statements</h2>
            {data.statements.length === 0 ? (
              <p className="bl-empty">
                {loadedFully
                  ? "No months with payments yet."
                  : "We couldn't read your monthly totals just now."}
              </p>
            ) : (
              <ul className="bl-months">
                {data.statements.map((s) => (
                  <li key={s.month}>
                    <span>
                      <strong>{monthLabel(s.month)}</strong>
                      <span>{s.payments} {s.payments === 1 ? "payment" : "payments"} · {money(s.total)}</span>
                    </span>
                    {/* CSV only. A PDF implies a document of record, and there
                        is none — Atlas offers both and wires neither. */}
                    <a href={`/api/client/billing/export?month=${s.month}`} className="btn btn-outline">CSV</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
