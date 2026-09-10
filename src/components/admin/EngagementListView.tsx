import Link from "next/link";
import type { EngagementRow } from "@/lib/adminEngagements";

/**
 * The engagement list, as a pure view — split from the route so it can be
 * rendered against fabricated rows, which is how the two banners below get
 * checked without a session.
 */

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

const money = (v: number | null) => (v === null ? "—" : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

const STATUS_TONE: Record<string, string> = {
  active: "ok",
  released: "mute",
  completed: "mute",
  payment_failed: "bad",
};

const CONTRACT_TONE: Record<string, string> = {
  fully_executed: "ok",
  pending_client: "warn",
  pending_candidate: "warn",
  draft: "mute",
};

export default function EngagementListView({ rows }: { rows: EngagementRow[] }) {
  const active = rows.filter((r) => r.status === "active").length;
  const escrowRows = rows.reduce((s, r) => s + r.escrow.total, 0);
  const escrowFunded = rows.reduce((s, r) => s + r.escrow.funded, 0);
  const executed = rows.filter((r) => r.contractStatus === "fully_executed").length;

  return (
    <div className="adm-col">
      <div className="adm-page-header">
        <div>
          <div className="adm-eyebrow">Operations</div>
          <h1>Engagements <span className="adm-serif-italic">in flight.</span></h1>
          <div className="adm-subhead">
            <strong>{rows.length}</strong> total
            <span className="sep">·</span>
            {active} active
            <span className="sep">·</span>
            {executed} of {rows.length} contracts signed
          </div>
        </div>
      </div>

      {rows.length > 0 && escrowRows > 0 && escrowFunded === 0 && (
        <div className="prof-banner">
          <span className="prof-banner-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18v12H3z" /><path d="M3 11h18" /></svg>
          </span>
          <div className="prof-banner-body">
            <div className="prof-banner-title">No money has moved on any engagement</div>
            <div className="prof-banner-text">
              All {escrowRows} escrow {escrowRows === 1 ? "row" : "rows"} across these engagements are
              still <code>pending</code> — nothing funded, nothing released. An engagement&apos;s own
              status is a separate thing from its escrow, so a row can read{" "}
              <code>released</code> here while its payment periods have never been funded.
            </div>
          </div>
        </div>
      )}

      {executed === 0 && rows.length > 0 && (
        <div className="prof-banner">
          <span className="prof-banner-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z" /><path d="M14 2.5V8h5.5" /></svg>
          </span>
          <div className="prof-banner-body">
            <div className="prof-banner-title">Not one contract has been fully executed</div>
            <div className="prof-banner-text">
              Every contract is waiting on a signature from one side or the other.
            </div>
          </div>
        </div>
      )}

      {rows.length > 0 ? (
        <div className="adm-panel">
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Candidate</th>
                  <th>Terms</th>
                  <th style={{ textAlign: "right" }}>Candidate</th>
                  <th style={{ textAlign: "right" }}>Client pays</th>
                  <th>Escrow</th>
                  <th>Contract</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Started</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="name">
                      <Link href={`/admin/engagements/${r.id}`} className="row-link">{r.clientName ?? "—"}</Link>
                    </td>
                    <td>
                      {r.candidateId
                        ? <Link href={`/admin/candidates/${r.candidateId}`} className="row-link">{r.candidateName ?? "—"}</Link>
                        : (r.candidateName ?? "—")}
                    </td>
                    <td>
                      {r.contractType}
                      {r.paymentCycle ? ` · ${r.paymentCycle}` : ""}
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>{money(r.candidateAmountUsd)}</td>
                    <td className="num" style={{ textAlign: "right" }}>{money(r.clientTotalUsd)}</td>
                    <td className="num">
                      {r.escrow.kind === "none"
                        ? "—"
                        : `${r.escrow.funded}/${r.escrow.total} ${r.escrow.kind === "milestones" ? "ms" : "periods"}`}
                    </td>
                    <td>
                      {r.contractStatus
                        ? <span className={`adm-pill ${CONTRACT_TONE[r.contractStatus] ?? "mute"}`}>{r.contractStatus.replace(/_/g, " ")}</span>
                        : <span className="adm-pill mute">none</span>}
                    </td>
                    <td><span className={`adm-pill ${STATUS_TONE[r.status] ?? "mute"}`}>{r.status.replace(/_/g, " ")}</span></td>
                    <td className="num" style={{ textAlign: "right" }}>{fmtDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="adm-state">No engagements have been created yet.</div>
      )}

      <p className="staff-legend" style={{ marginTop: 16 }}>
        On an ongoing contract the candidate figure is the amount for one payment cycle, not an
        hourly rate — every payment period on the platform is written for exactly that amount, and{" "}
        <code>weekly_hours</code> is unset on every engagement.
      </p>
    </div>
  );
}
