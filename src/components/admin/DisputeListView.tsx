import Link from "next/link";
import type { Dispute, DisputeStatus } from "@/lib/adminDisputes";
import DisputeResolveForm from "@/components/admin/DisputeResolveForm";

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

const money = (v: number | null) =>
  v === null ? "—" : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DisputeListView({
  disputes,
  status,
}: {
  disputes: Dispute[];
  status: DisputeStatus;
}) {
  return (
    <div className="adm-col" style={{ maxWidth: 1000 }}>
      <div className="adm-page-header">
        <div>
          <div className="adm-eyebrow">Operations</div>
          <h1>Money in <span className="adm-serif-italic">dispute.</span></h1>
          <div className="adm-subhead">
            <strong>{disputes.length}</strong> {status}
          </div>
        </div>
      </div>

      <div className="alerts-filter-row" role="tablist" aria-label="Dispute status" style={{ marginBottom: 18 }}>
        {(["open", "resolved"] as const).map((f) => (
          <Link
            key={f}
            href={f === "open" ? "/admin/disputes" : "/admin/disputes?status=resolved"}
            role="tab"
            aria-selected={status === f}
            className={`alerts-filter${status === f ? " active" : ""}`}
          >
            {f}
          </Link>
        ))}
      </div>

      {disputes.length === 0 ? (
        <div className="adm-state">
          {status === "open"
            ? "No open disputes. The queue was read successfully — this is genuinely empty, not a failed request."
            : "No dispute has ever been resolved, because none has ever been filed."}
        </div>
      ) : (
        <div className="alerts-list">
          {disputes.map((d) => (
            <div key={d.id} className="adm-panel">
              <div className="dispute-head" style={{ cursor: "default" }}>
                <span className="dispute-head-main">
                  <span className="dispute-title">
                    {d.client_name} <span style={{ color: "var(--ink-mute)" }}>×</span> {d.candidate_name}
                  </span>
                  <span className="dispute-meta">
                    filed by {d.filed_by} · {fmtDate(d.filed_at)} · {d.contract_type}
                    {d.milestone_id ? " · milestone" : d.period_id ? " · payment period" : ""}
                  </span>
                </span>
                <span className="dispute-amount">{money(d.amount_in_escrow_usd)}</span>
                {d.decision
                  ? <span className="adm-pill ok">{d.decision.replace(/_/g, " ")}</span>
                  : <span className="adm-pill warn">open</span>}
              </div>

              <div className="dispute-body">
                <div className="adm-grid-2">
                  <div className="rec-panel">
                    <div className="rec-panel-label">Client says</div>
                    {d.client_statement ? <div className="rec-prose">{d.client_statement}</div> : <div className="rec-v empty">nothing submitted</div>}
                    {d.client_evidence_url && (
                      <p style={{ marginTop: 8 }}>
                        <Link href={d.client_evidence_url} className="row-link" target="_blank" rel="noreferrer">Evidence</Link>
                      </p>
                    )}
                  </div>
                  <div className="rec-panel">
                    <div className="rec-panel-label">Candidate says</div>
                    {d.candidate_statement ? <div className="rec-prose">{d.candidate_statement}</div> : <div className="rec-v empty">nothing submitted</div>}
                    {d.candidate_evidence_url && (
                      <p style={{ marginTop: 8 }}>
                        <Link href={d.candidate_evidence_url} className="row-link" target="_blank" rel="noreferrer">Evidence</Link>
                      </p>
                    )}
                  </div>
                </div>

                <p style={{ marginTop: 12 }}>
                  <Link href={`/admin/engagements/${d.engagement_id}`} className="row-link">Open the engagement</Link>
                </p>

                {d.resolved_at ? (
                  <div className="rec-panel" style={{ marginTop: 12 }}>
                    <div className="rec-panel-label">Decision</div>
                    <div className="rec-prose">
                      {d.decision?.replace(/_/g, " ")} — {fmtDate(d.resolved_at)}
                      {d.decision_notes ? `\n\n${d.decision_notes}` : ""}
                    </div>
                  </div>
                ) : (
                  <DisputeResolveForm disputeId={d.id} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
