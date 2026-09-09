"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ContractReviewModal from "@/components/ContractReviewModal";
import { PAUSE_AUTO_END_DAYS } from "@/lib/engagementLifecycle";
import { BLOCK_COPY, type BlockReason } from "@/lib/contractTerms";

type State = "active" | "paused" | "ending" | "awaiting_signature" | "awaiting_countersign" | "blocked" | "ended";
type Tab = "active" | "pending" | "past";

interface Contract {
  id: string;
  engagementId: string;
  contractStatus: string;
  state: State;
  waitingOn: "client" | "candidate" | null;
  blockReason: BlockReason | null;
  paymentFailed: boolean;
  generatedAt: string;
  clientSignedAt: string | null;
  candidateSignedAt: string | null;
  pdfUrl: string | null;
  terms: {
    candidateRate: number | null;
    clientTotal: number | null;
    /** "hourly" | "weekly" | "biweekly" | "monthly" — what the amounts mean. */
    rateBasis: string;
    weeklyHours: number | null;
    contractType: string | null;
    paymentCycle: string | null;
    createdAt: string | null;
  } | null;
  pause: {
    at: string;
    by: string | null;
    reason: string | null;
    note: string | null;
    resumeExpected: string | null;
    autoEndAt: string | null;
    autoEndDays: number;
    canResume: boolean;
  } | null;
  notice: {
    givenAt: string | null;
    givenBy: string | null;
    endsAt: string;
    days: number;
    over: boolean;
  } | null;
  candidate: {
    id: string;
    displayName: string;
    roleCategory: string | null;
    country: string | null;
    photo: string | null;
  } | null;
}

const STATE_LABEL: Record<State, string> = {
  active: "Active",
  paused: "Paused",
  ending: "Ending",
  awaiting_signature: "Awaiting signature",
  awaiting_countersign: "Awaiting countersignature",
  blocked: "Can't be signed",
  ended: "Ended",
};

const REASONS: { key: string; label: string }[] = [
  { key: "slow_season", label: "Slow season" },
  { key: "vacation", label: "Time off" },
  { key: "project_pivot", label: "Change of plan" },
  { key: "other", label: "Something else" },
];

const REASON_LABEL: Record<string, string> = Object.fromEntries(REASONS.map((r) => [r.key, r.label]));

/** What the stored amounts are per. Hourly only when no cycle is set. */
const BASIS_SUFFIX: Record<string, string> = {
  hourly: "/hr",
  weekly: " a week",
  biweekly: " every 2 weeks",
  monthly: " a month",
};

/** Raw enum values never reach a screen. */
const TYPE_LABEL: Record<string, string> = { ongoing: "Ongoing", project: "Project" };

const money = (n: number) =>
  // Cents kept when there are any: rounding $5.50 to "$6" misstates a real
  // weekly rate on the live rows.
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });

/** A timestamptz in the reader's own zone. */
const stamp = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** A DATE column — pinned to UTC, or it prints a day early west of UTC. */
const dateOnly = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });

/**
 * The client's contracts page.
 *
 * The pause modal is the point of this step. Atlas collects a reason and an
 * expected resume date and its JS reads neither — the recon records both
 * inputs as "read by nobody", and its confirm handler hardcodes one card
 * regardless of which contract was targeted. Both fields are stored here and
 * both are shown back, to both sides.
 *
 * ⚠️ The expected date is an EXPECTATION and the copy never says otherwise.
 * Atlas promises "auto-resumes on the date you set"; our automation runs the
 * other way — 30 days paused ENDS the agreement as though notice had been
 * given. Saying "auto-resume" here would promise the opposite of what the
 * platform does.
 *
 * Atlas features not built, and why:
 *  - The contract-generation wizard (its step 15). A contract is generated
 *    from the accepted offer, so a second term-entry form would be a second
 *    source of truth for the deal.
 *  - "CTR-2025-0103-ML" contract ids. No such scheme exists.
 *  - The "What's next" feed, including a scheduled 30-day review. There is no
 *    review cycle to schedule against.
 *  - "Avg approval time" and the portfolio run-rate panel — step 15's
 *    billing surface owns the money view.
 *  - "Download archive". The PDF link is real, and appears only when a PDF
 *    exists — which today is never: contract_pdf_url is null on all eight
 *    live contracts because generation runs on full execution and nothing is
 *    fully executed yet.
 *  - The ".ct-hours-pending" callout ("23 hours pending approval"). That is a
 *    TIMESHEET, and the owner's D2 keeps funded periods and rules them out.
 *    There are no logged hours to be pending.
 *  - "Nudge" on a pending contract and "Cancel contract". Both are real gaps
 *    rather than fictions — four contracts have sat awaiting a candidate
 *    signature since April with no way to chase them, and four await the
 *    client with no way to withdraw. Each needs its own decision about what
 *    the other side is told, so neither is drawn as a button that does
 *    nothing.
 *  - Atlas's per-card "View profile". Messaging is the action that matters
 *    here; the profile is one hop from there.
 *  - The escrow side panel. Step 15 owns the money view.
 */
export default function ContractsView() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("active");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [cardError, setCardError] = useState<{ id: string; message: string } | null>(null);
  const [truncated, setTruncated] = useState(false);

  // The pause dialog, per contract.
  // The contract being read/signed, and its HTML. The card used to link to
  // /contracts/sign/[id], which redirects to /candidate/contracts and then
  // bounces a client to /dashboard — the page's headline action did nothing
  // but round-trip. ContractReviewModal is the component /team already uses
  // for the client's countersignature.
  const [reading, setReading] = useState<{ id: string; html: string } | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const [pausing, setPausing] = useState<Contract | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [resumeExpected, setResumeExpected] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/client/contracts");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Could not load your contracts.");
        return;
      }
      const data = await res.json();
      setContracts(data.contracts || []);
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

  const bucketOf = (c: Contract): Tab =>
    c.state === "awaiting_signature" || c.state === "awaiting_countersign"
      ? "pending"
      : c.state === "ended"
        ? "past"
        : "active";

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { active: 0, pending: 0, past: 0 };
    for (const k of contracts) c[bucketOf(k)]++;
    return c;
  }, [contracts]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contracts.filter((c) => {
      if (bucketOf(c) !== tab) return false;
      if (!q) return true;
      return (
        (c.candidate?.displayName || "").toLowerCase().includes(q) ||
        (c.candidate?.roleCategory || "").toLowerCase().includes(q)
      );
    });
  }, [contracts, tab, search]);

  /**
   * Opening the pause dialog resets its fields. They are page-level state and
   * were only cleared on SUCCESS, so cancelling on one card and pausing
   * another sent the first card's reason, note and expected date — storing a
   * note about one contractor on another contractor's engagement, and quoting
   * it back to them.
   */
  function openPause(c: Contract) {
    setReason("");
    setNote("");
    setResumeExpected("");
    setCardError(null);
    setPausing(c);
  }

  function closePause() {
    setPausing(null);
    setReason("");
    setNote("");
    setResumeExpected("");
  }

  async function pauseAction(engagementId: string, action: "pause" | "resume", extra?: Record<string, unknown>) {
    setBusy(engagementId);
    setCardError(null);
    try {
      const res = await fetch("/api/engagements/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, engagementId, ...extra }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCardError({ id: engagementId, message: body.error || "That didn't work." });
        return;
      }
      closePause();
      await load();
    } catch {
      setCardError({ id: engagementId, message: "Could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  async function openContract(id: string) {
    setOpeningId(id);
    setCardError(null);
    try {
      const res = await fetch(`/api/contracts/view?contractId=${encodeURIComponent(id)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCardError({ id, message: body.error || "Couldn't open that agreement." });
        return;
      }
      const data = await res.json();
      setReading({ id, html: data.contractHtml || data.contract_html || "" });
    } catch {
      setCardError({ id, message: "Could not reach the server." });
    } finally {
      setOpeningId(null);
    }
  }

  if (loading) return <section className="ct"><p className="ct-lead">Loading your contracts…</p></section>;

  if (error) {
    return (
      <section className="ct">
        <h1 className="ct-title">Contracts</h1>
        <p className="ct-error">{error}</p>
      </section>
    );
  }

  return (
    <section className="ct">
      <h1 className="ct-title">Contracts</h1>
      <p className="ct-lead">
        {contracts.length === 0
          ? "No contracts yet. One is drawn up automatically when a candidate accepts your offer."
          : "Every agreement you've made, and what each engagement is doing right now."}
      </p>

      {truncated && (
        <p className="ct-error">Showing your most recent 200 contracts.</p>
      )}

      {contracts.length === 0 ? (
        <div className="ct-empty">
          <p>Accept a proposal and the agreement appears here, ready for signature.</p>
          <Link href="/proposals" className="btn btn-primary">Your proposals</Link>
        </div>
      ) : (
        <>
          <div className="ct-controls">
            <div className="ct-tabs" role="tablist" aria-label="Filter contracts">
              {(["active", "pending", "past"] as Tab[]).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  className={`ct-tab${tab === k ? " active" : ""}`}
                  onClick={() => setTab(k)}
                >
                  {k === "active" ? "Active" : k === "pending" ? "Awaiting signature" : "Past"}
                  <span className={`ct-tab-count${counts[k] === 0 ? " zero" : ""}`}>{counts[k]}</span>
                </button>
              ))}
            </div>
            <input
              type="search"
              className="ct-search"
              placeholder="Search by name or role"
              aria-label="Search contracts"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {visible.length === 0 ? (
            <div className="ct-empty"><p>Nothing in this tab.</p></div>
          ) : (
            visible.map((c) => (
              <article key={c.id} className={`ct-card st-${c.state}`}>
                <div className="ct-card-top">
                  <div
                    className="ct-avatar"
                    style={c.candidate?.photo ? { backgroundImage: `url("${encodeURI(c.candidate.photo)}")` } : undefined}
                    aria-hidden
                  >
                    {!c.candidate?.photo && (c.candidate?.displayName?.[0] || "?").toUpperCase()}
                  </div>
                  <div className="ct-card-id">
                    <div className="ct-card-name">{c.candidate?.displayName || "Candidate"}</div>
                    <div className="ct-card-sub">
                      {[c.candidate?.roleCategory, c.candidate?.country].filter(Boolean).join(" · ")}
                      {c.terms?.createdAt ? ` · agreed ${stamp(c.terms.createdAt)}` : ""}
                    </div>
                  </div>
                  <span className={`ct-status st-${c.state}`}>{STATE_LABEL[c.state]}</span>
                </div>

                {c.terms && (
                  <div className="ct-terms">
                    {/* Labelled from rateBasis, never assumed hourly. */}
                    <div>
                      <span>They&apos;re paid</span>
                      <span>{c.terms.candidateRate != null ? `${money(c.terms.candidateRate)}${BASIS_SUFFIX[c.terms.rateBasis] ?? ""}` : "—"}</span>
                    </div>
                    {c.terms.weeklyHours != null && (
                      <div><span>Hours</span><span>{c.terms.weeklyHours}/wk</span></div>
                    )}
                    <div>
                      <span>Your cost</span>
                      <span>{c.terms.clientTotal != null ? `${money(c.terms.clientTotal)}${BASIS_SUFFIX[c.terms.rateBasis] ?? ""}` : "—"}</span>
                    </div>
                    <div><span>Type</span><span>{TYPE_LABEL[c.terms.contractType ?? ""] ?? c.terms.contractType ?? "—"}</span></div>
                  </div>
                )}

                {/* Awaiting signature: say who it is waiting on, from the two
                    signature timestamps rather than from the status word. */}
                {c.waitingOn && (
                  <p className="ct-note">
                    {c.waitingOn === "client"
                      ? "Waiting on your signature."
                      : `Signed by you${c.clientSignedAt ? ` on ${stamp(c.clientSignedAt)}` : ""} — waiting on ${c.candidate?.displayName || "the candidate"}.`}
                  </p>
                )}

                {c.blockReason && c.blockReason !== "not_awaiting_you" && (
                  // The shared copy, so both sides of the market read the same
                  // sentence about the same condition.
                  <div className="ct-pause">
                    <strong>{BLOCK_COPY[c.blockReason].title}</strong>
                    <span>{BLOCK_COPY[c.blockReason].detail}</span>
                  </div>
                )}

                {c.paymentFailed && (
                  <p className="ct-note">
                    A payment on this engagement didn&apos;t go through. It is still live — the
                    contract has not ended.
                  </p>
                )}

                {c.pause && (
                  <div className="ct-pause">
                    <strong>
                      Paused {stamp(c.pause.at)}
                      {c.pause.by === "client"
                        ? " by you"
                        : c.pause.by === "candidate"
                          ? ` by ${c.candidate?.displayName || "the candidate"}`
                          : ""}
                      {c.pause.reason ? ` · ${REASON_LABEL[c.pause.reason] ?? c.pause.reason}` : ""}
                    </strong>
                    {c.pause.note && <span>“{c.pause.note}”</span>}
                    {c.pause.resumeExpected && (
                      // Expected, not scheduled. Nothing restarts on its own.
                      <span>Expected back around {dateOnly(c.pause.resumeExpected)} — someone still has to resume it.</span>
                    )}
                    {c.notice && (
                      // Notice can be given while paused, and two independent
                      // blocks then printed two different end dates on one
                      // card. Notice wins: it is the dated one.
                      <span className="warn">
                        Notice has also been given — this ends {stamp(c.notice.endsAt)}.
                      </span>
                    )}
                    {c.pause.autoEndAt && !c.notice && (
                      <span className="warn">
                        If nobody resumes it, the agreement ends {stamp(c.pause.autoEndAt)} —
                        {" "}{c.pause.autoEndDays} days from the pause.
                      </span>
                    )}
                  </div>
                )}

                {c.notice && !c.pause && (
                  <div className="ct-pause">
                    <strong>
                      Notice given{c.notice.givenBy ? ` by ${c.notice.givenBy === "client" ? "you" : c.candidate?.displayName || "the candidate"}` : ""}
                      {c.notice.givenAt ? ` on ${stamp(c.notice.givenAt)}` : ""}
                    </strong>
                    <span>
                      {c.notice.over ? "Ended " : "Ends "}{stamp(c.notice.endsAt)}. Work and pay continue until then.
                    </span>
                  </div>
                )}

                <div className="ct-actions">
                  <button
                    className={`btn ${c.waitingOn === "client" ? "btn-primary" : "btn-outline"}`}
                    disabled={openingId === c.id}
                    onClick={() => openContract(c.id)}
                  >
                    {openingId === c.id
                      ? "Opening…"
                      : c.waitingOn === "client"
                        ? "Review and sign"
                        : "View agreement"}
                  </button>
                  {c.pdfUrl && (
                    <a href={c.pdfUrl} className="btn btn-outline" target="_blank" rel="noopener noreferrer">PDF</a>
                  )}
                  {c.state === "active" && (
                    <button className="btn btn-outline" onClick={() => openPause(c)}>Pause</button>
                  )}
                  {c.state === "paused" && c.pause?.canResume && (
                    <button
                      className="btn btn-primary"
                      disabled={busy === c.engagementId}
                      onClick={() => pauseAction(c.engagementId, "resume")}
                    >
                      {busy === c.engagementId ? "Working…" : "Resume"}
                    </button>
                  )}
                  {c.state === "paused" && !c.pause?.canResume && (
                    // Only the pauser may resume; saying so beats a button
                    // that 409s. With no recorded pauser, neither side can —
                    // and inventing one would be worse than saying so.
                    <span className="ct-hint">
                      {c.pause?.by === "candidate"
                        ? `${c.candidate?.displayName || "The candidate"} paused this — only they can resume it.`
                        : "This pause has no recorded owner, so neither side can resume it. Contact support."}
                    </span>
                  )}
                  {c.candidate && (
                    <Link href={`/messages?candidate=${c.candidate.id}`} className="btn btn-outline">Message</Link>
                  )}
                </div>
                {cardError?.id === c.engagementId && <p className="ct-card-err">{cardError.message}</p>}
              </article>
            ))
          )}
        </>
      )}

      {pausing && (
        <div className="ct-modal-backdrop" onClick={closePause}>
          <div
            className="ct-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Pause this contract"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Pause the contract with {pausing.candidate?.displayName || "this candidate"}?</h2>
            <p className="ct-modal-lead">
              The agreement and its signed terms stay in place. No new payment periods accrue while
              it is paused, and anything already approved is paid as normal.
            </p>
            <p className="ct-modal-warn">
              Only you will be able to resume it. If nobody does within {PAUSE_AUTO_END_DAYS} days,
              the agreement ends automatically, as though notice had been given.
            </p>

            <fieldset className="ct-modal-reasons">
              <legend>Why are you pausing? (optional)</legend>
              {/* "Rather not say" is the default and sends nothing. With a
                  pre-selected reason, a client who ignored the question was
                  recorded as having SAID "slow season", and the candidate was
                  told they gave that reason — a statement attributed to
                  someone who never made it. */}
              <label className={reason === "" ? "on" : undefined}>
                <input type="radio" name="pause-reason" checked={reason === ""} onChange={() => setReason("")} />
                Rather not say
              </label>
              {REASONS.map((r) => (
                <label key={r.key} className={reason === r.key ? "on" : undefined}>
                  <input
                    type="radio"
                    name="pause-reason"
                    checked={reason === r.key}
                    onChange={() => setReason(r.key)}
                  />
                  {r.label}
                </label>
              ))}
            </fieldset>
            {reason === "other" && (
              <input
                type="text"
                className="ct-modal-input"
                placeholder="A short note for them"
                maxLength={300}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}

            <label className="ct-modal-field">
              <span>When do you expect to restart? (optional)</span>
              <input
                type="date"
                className="ct-modal-input"
                value={resumeExpected}
                min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
                onChange={(e) => setResumeExpected(e.target.value)}
              />
              <small>
                We&apos;ll tell them what you expect. It doesn&apos;t restart anything on its own —
                you resume it when you&apos;re ready.
              </small>
            </label>

            <div className="ct-modal-actions">
              <button className="btn btn-outline" onClick={closePause}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={busy === pausing.engagementId}
                onClick={() =>
                  pauseAction(pausing.engagementId, "pause", {
                    reason: reason || undefined,
                    note: reason === "other" ? note : undefined,
                    resumeExpected: resumeExpected || undefined,
                  })
                }
              >
                {busy === pausing.engagementId ? "Pausing…" : "Pause contract"}
              </button>
            </div>
            {cardError?.id === pausing.engagementId && (
              <p className="ct-card-err">{cardError.message}</p>
            )}
          </div>
        </div>
      )}
      {reading && (
        <ContractReviewModal
          contractId={reading.id}
          contractHtml={reading.html}
          onSigned={() => {
            setReading(null);
            load();
          }}
          onClose={() => setReading(null)}
        />
      )}
    </section>
  );
}
