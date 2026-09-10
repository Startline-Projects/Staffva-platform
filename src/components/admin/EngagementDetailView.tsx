import Link from "next/link";
import type { EngagementDetail } from "@/lib/adminEngagements";

/**
 * One engagement: who, on what terms, under which contract, and what the money
 * has actually done.
 *
 * The escrow table is the point of the page. `engagements.status` says nothing
 * about whether anyone has been paid — the two live independently — so the
 * money state is shown as its own section with its own statuses, and the two
 * are never conflated in a single badge.
 */

const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

const fmtDateTime = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : null;

const money = (v: number | null | undefined) =>
  v === null || v === undefined ? null : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ESCROW_TONE: Record<string, string> = {
  pending: "mute", funded: "warn", candidate_marked_complete: "warn",
  approved: "warn", released: "ok", disputed: "bad", refunded: "bad",
};

function Field({ k, v, tone, mono, note }: {
  k: string; v: React.ReactNode; tone?: "ok" | "warn" | "bad"; mono?: boolean; note?: string | null;
}) {
  const isEmpty = v === null || v === undefined || v === "";
  return (
    <div className="rec-field">
      <div className="rec-k">{k}</div>
      <div className={`rec-v${isEmpty ? " empty" : ""}${tone && !isEmpty ? ` ${tone}` : ""}${mono && !isEmpty ? " mono" : ""}`}>
        {isEmpty ? "not on file" : v}
      </div>
      {note && <div className="rec-note-line">{note}</div>}
    </div>
  );
}

export default function EngagementDetailView({ record }: { record: EngagementDetail }) {
  const {
    e, status, contractType, paymentCycle, candidateAmountUsd, platformFeeUsd, clientTotalUsd,
    createdAt, clientId, clientName, candidateId, candidateName, contract, milestones, periods, escrow,
  } = record;

  const isOngoing = contractType === "ongoing";
  const amountLabel = isOngoing ? `Candidate · per ${paymentCycle ?? "cycle"}` : "Candidate · project";

  const escrowRows = milestones.length ? milestones : periods;
  const escrowTotal = escrowRows.reduce((s, r) => s + (r.amountUsd ?? 0), 0);

  // For a project engagement the milestone amounts and the engagement's own
  // totals are written separately and nothing keeps them in step. Say so when
  // they disagree rather than showing two numbers and letting a reader assume
  // one is the other's breakdown.
  const totalsDisagree =
    escrow.kind === "milestones" &&
    candidateAmountUsd !== null &&
    Math.abs(escrowTotal - candidateAmountUsd) > 0.01;

  const paused = Boolean(e.paused_at);

  return (
    <div className="adm-col" style={{ maxWidth: 1000 }}>
      <Link href="/admin/engagements" className="rec-back">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        All engagements
      </Link>

      <div className="rec-hero">
        <div className="rec-hero-top">
          <div className="rec-photo" style={{ background: "linear-gradient(135deg, #7C93C4, #16213E)" }} aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z" /><path d="M14 2.5V8h5.5" /><path d="M8.5 13h7M8.5 16.5h4.5" /></svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="rec-title">
              {clientName ?? "Unknown client"} <span style={{ color: "var(--ink-mute)", fontSize: "0.7em" }}>×</span> {candidateName ?? "Unknown candidate"}
              <span className={`adm-pill ${status === "active" ? "ok" : status === "payment_failed" ? "bad" : "mute"}`}>
                {status.replace(/_/g, " ")}
              </span>
              {paused && <span className="adm-pill warn">Paused</span>}
            </h1>
            <div className="rec-sub">
              <span>{contractType}{paymentCycle ? ` · ${paymentCycle}` : ""}</span>
              <span className="sep">·</span>
              <span>started {fmtDate(createdAt)}</span>
              {e.is_direct_contract && <><span className="sep">·</span><span>direct contract</span></>}
            </div>
          </div>
        </div>

        <div className="rec-facts">
          <div className="rec-fact">
            <div className="rec-k">{amountLabel}</div>
            <div className="rec-v">{money(candidateAmountUsd) ?? "—"}</div>
          </div>
          <div className="rec-fact">
            <div className="rec-k">Platform fee</div>
            <div className="rec-v">{money(platformFeeUsd) ?? "—"}</div>
          </div>
          <div className="rec-fact">
            <div className="rec-k">Client pays</div>
            <div className="rec-v">{money(clientTotalUsd) ?? "—"}</div>
          </div>
          <div className="rec-fact">
            <div className="rec-k">Escrow moved</div>
            <div className={`rec-v${escrow.total > 0 && escrow.funded === 0 ? " warn" : ""}`}>
              {escrow.kind === "none" ? "no rows" : `${escrow.funded} of ${escrow.total}`}
            </div>
          </div>
        </div>
      </div>

      {escrow.total > 0 && escrow.funded === 0 && (
        <div className="prof-banner">
          <span className="prof-banner-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18v12H3z" /><path d="M3 11h18" /></svg>
          </span>
          <div className="prof-banner-body">
            <div className="prof-banner-title">Nothing has been funded on this engagement</div>
            <div className="prof-banner-text">
              Every {escrow.kind === "milestones" ? "milestone" : "payment period"} is still{" "}
              <code>pending</code>. The engagement status above says <code>{status}</code>, which
              describes the engagement and not the escrow.
            </div>
          </div>
        </div>
      )}

      {totalsDisagree && (
        <div className="prof-banner info">
          <span className="prof-banner-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 16v-5M12 8.2v.1" /></svg>
          </span>
          <div className="prof-banner-body">
            <div className="prof-banner-title">The milestones do not add up to the engagement total</div>
            <div className="prof-banner-text">
              Milestones total <strong>{money(escrowTotal)}</strong>; the engagement records{" "}
              <strong>{money(candidateAmountUsd)}</strong> for the candidate. The two are written
              separately and nothing reconciles them, so neither is a breakdown of the other.
            </div>
          </div>
        </div>
      )}

      <section className="rec-section">
        <div className="rec-section-head"><h2>Parties</h2></div>
        <div className="rec-grid">
          <Field
            k="Client"
            v={clientId ? <Link href={`/admin/clients/${clientId}`} className="row-link">{clientName ?? "open record"}</Link> : clientName}
          />
          <Field
            k="Candidate"
            v={candidateId ? <Link href={`/admin/candidates/${candidateId}`} className="row-link">{candidateName ?? "open record"}</Link> : candidateName}
          />
          <Field k="Contract type" v={contractType} />
          <Field k="Payment cycle" v={paymentCycle} />
          <Field k="Weekly hours" v={e.weekly_hours ?? null} mono note={e.weekly_hours === null ? "unset on every engagement" : null} />
          <Field k="Direct contract" v={e.is_direct_contract === null || e.is_direct_contract === undefined ? null : e.is_direct_contract ? "Yes" : "No"} />
        </div>
      </section>

      <section className="rec-section">
        <div className="rec-section-head"><h2>Lifecycle</h2></div>
        <div className="rec-grid">
          <Field k="Started" v={fmtDate(createdAt)} />
          <Field k="Lock activated" v={fmtDate(e.lock_activated_at)} />
          <Field k="Lock released" v={fmtDate(e.lock_released_at)} />
          <Field k="Notice given" v={fmtDate(e.notice_given_at)} note={e.notice_given_by ? `by ${e.notice_given_by}` : null} />
          <Field k="Ends" v={fmtDate(e.ends_at)} />
          <Field k="Paused" v={fmtDate(e.paused_at)} tone={paused ? "warn" : undefined} note={e.paused_by ? `by ${e.paused_by}` : null} />
          <Field k="Resumed" v={fmtDate(e.last_resumed_at)} />
          <Field k="Resume expected" v={fmtDate(e.pause_resume_expected)} />
        </div>
        {(e.pause_reason || e.pause_note) && (
          <div className="rec-panel" style={{ marginTop: 12 }}>
            <div className="rec-panel-label">Pause</div>
            <div className="rec-prose">{[e.pause_reason, e.pause_note].filter(Boolean).join(" — ")}</div>
          </div>
        )}
      </section>

      <section className="rec-section">
        <div className="rec-section-head"><h2>Contract</h2></div>
        {contract ? (
          <div className="rec-grid">
            <Field
              k="Status"
              v={contract.status.replace(/_/g, " ")}
              tone={contract.status === "fully_executed" ? "ok" : "warn"}
            />
            <Field k="Generated" v={fmtDate(contract.generatedAt)} />
            <Field k="Client signed" v={fmtDate(contract.clientSignedAt)} tone={contract.clientSignedAt ? "ok" : undefined} />
            <Field k="Candidate signed" v={fmtDate(contract.candidateSignedAt)} tone={contract.candidateSignedAt ? "ok" : undefined} />
            <Field k="PDF" v={contract.pdfUrl ? <Link href={contract.pdfUrl} className="row-link" target="_blank" rel="noreferrer">Open</Link> : null} />
          </div>
        ) : (
          <div className="rec-empty">No contract has been generated for this engagement.</div>
        )}
      </section>

      <section className="rec-section">
        <div className="rec-section-head">
          <h2>
            {escrow.kind === "milestones" ? "Milestones" : "Payment periods"}
            {escrowRows.length > 0 && <span className="count">{money(escrowTotal)} total</span>}
          </h2>
        </div>

        {escrowRows.length === 0 ? (
          <div className="rec-empty">
            No milestones or payment periods exist for this engagement, so there is nothing for
            escrow to hold.
          </div>
        ) : (
          <div className="adm-panel">
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>{escrow.kind === "milestones" ? "Milestone" : "Period"}</th>
                    <th style={{ textAlign: "right" }}>Amount</th>
                    <th>Status</th>
                    <th>Funded</th>
                    <th>Released</th>
                    <th>Auto-release</th>
                  </tr>
                </thead>
                <tbody>
                  {milestones.map((m) => (
                    <tr key={m.id}>
                      <td className="name">
                        {m.title || "untitled"}
                        {m.payoutFailed && <div className="rec-note-line" style={{ color: "var(--danger)" }}>payout failed: {m.payoutFailureReason ?? "no reason recorded"}</div>}
                      </td>
                      <td className="num" style={{ textAlign: "right" }}>{money(m.amountUsd) ?? "—"}</td>
                      <td><span className={`adm-pill ${ESCROW_TONE[m.status] ?? "mute"}`}>{m.status.replace(/_/g, " ")}</span></td>
                      <td className="num">{fmtDate(m.fundedAt) ?? "—"}</td>
                      <td className="num">{fmtDate(m.releasedAt) ?? "—"}</td>
                      <td className="num">{fmtDateTime(m.autoReleaseAt) ?? "—"}</td>
                    </tr>
                  ))}
                  {periods.map((p) => (
                    <tr key={p.id}>
                      <td className="name">
                        {fmtDate(p.periodStart) ?? "—"} → {fmtDate(p.periodEnd) ?? "—"}
                        {p.disputeFiledAt && <div className="rec-note-line" style={{ color: "var(--danger)" }}>disputed {fmtDate(p.disputeFiledAt)}</div>}
                        {p.payoutFailed && <div className="rec-note-line" style={{ color: "var(--danger)" }}>payout failed: {p.payoutFailureReason ?? "no reason recorded"}</div>}
                      </td>
                      <td className="num" style={{ textAlign: "right" }}>{money(p.amountUsd) ?? "—"}</td>
                      <td><span className={`adm-pill ${ESCROW_TONE[p.status] ?? "mute"}`}>{p.status}</span></td>
                      <td className="num">{fmtDate(p.fundedAt) ?? "—"}</td>
                      <td className="num">{fmtDate(p.releasedAt) ?? "—"}</td>
                      <td className="num">{fmtDateTime(p.autoReleaseAt) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
