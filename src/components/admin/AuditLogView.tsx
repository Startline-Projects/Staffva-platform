import Link from "next/link";
import { AUDIT_PAGE_SIZE, type AuditPage } from "@/lib/adminAudit";

const fmtDateTime = (v: string) =>
  new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

const SUBJECT_HREF: Record<string, (id: string) => string> = {
  candidate: (id) => `/admin/candidates/${id}`,
  client: (id) => `/admin/clients/${id}`,
  engagement: (id) => `/admin/engagements/${id}`,
};

const ACTION_TONE: Record<string, string> = {
  "ban.confirm": "bad",
  "candidate.reject": "bad",
  "review.takedown": "warn",
  "dispute.resolve": "warn",
  "candidate.approve": "ok",
  "candidate.reinstate": "ok",
  "review.restore": "ok",
};

function href(page: number, action: string | null) {
  const p = new URLSearchParams();
  if (action) p.set("action", action);
  if (page > 1) p.set("page", String(page));
  const q = p.toString();
  return `/admin/audit${q ? `?${q}` : ""}`;
}

export default function AuditLogView({ page, action }: { page: AuditPage; action: string | null }) {
  const lastPage = Math.max(1, Math.ceil(page.total / AUDIT_PAGE_SIZE));

  return (
    <div className="adm-col" style={{ maxWidth: 1080 }}>
      <div className="adm-page-header">
        <div>
          <div className="adm-eyebrow">Trust &amp; safety</div>
          <h1>Who did <span className="adm-serif-italic">what.</span></h1>
          <div className="adm-subhead">
            <strong>{page.total.toLocaleString()}</strong> {page.total === 1 ? "action" : "actions"} on record
          </div>
        </div>
      </div>

      <p className="staff-legend">
        Every staff decision that moves something: approvals and rejections, ban rulings, lockout
        lifts, review takedowns, dispute resolutions. Rows are append-only — the database refuses
        UPDATE and DELETE on this table for every role, including the service key that writes it.
        Nothing here can be edited after the fact, by anyone.
      </p>

      {page.actions.length > 1 && (
        <div className="alerts-filter-row" role="tablist" aria-label="Filter by action" style={{ marginBottom: 18 }}>
          <Link href={href(1, null)} role="tab" aria-selected={!action} className={`alerts-filter${!action ? " active" : ""}`}>
            All
          </Link>
          {page.actions.map((a) => (
            <Link
              key={a}
              href={href(1, a)}
              role="tab"
              aria-selected={action === a}
              className={`alerts-filter${action === a ? " active" : ""}`}
            >
              {a.replace(/[._]/g, " ")}
            </Link>
          ))}
        </div>
      )}

      {page.total === 0 ? (
        <div className="adm-state">
          Nothing has been recorded yet. The log starts from the moment it shipped — decisions taken
          before it exists are not in here and never will be, which is why the older history on a
          candidate record still reads &ldquo;actor not recorded&rdquo;.
        </div>
      ) : (
        <>
          <div className="adm-panel">
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>What</th>
                    <th style={{ textAlign: "right" }}>Subject</th>
                  </tr>
                </thead>
                <tbody>
                  {page.rows.map((r) => {
                    const link = r.subjectId ? SUBJECT_HREF[r.subjectType]?.(r.subjectId) : null;
                    return (
                      <tr key={r.id}>
                        <td className="num" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.createdAt)}</td>
                        <td>
                          <div className="user-cell-text">
                            <span className="name">{r.actorName ?? (r.actorRole === "system" ? "system" : "no longer on file")}</span>
                            <span className="user-cell-email">{r.actorRole}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`adm-pill ${ACTION_TONE[r.action] ?? "mute"}`}>
                            {r.action.replace(/[._]/g, " ")}
                          </span>
                        </td>
                        <td>{r.summary}</td>
                        <td style={{ textAlign: "right" }}>
                          {link
                            ? <Link href={link} className="row-link">Open</Link>
                            : <span className="rec-v empty" style={{ fontSize: 12 }}>{r.subjectType}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="users-pager">
            <span className="pager-meta">
              {((page.page - 1) * AUDIT_PAGE_SIZE + 1).toLocaleString()}–
              {Math.min(page.page * AUDIT_PAGE_SIZE, page.total).toLocaleString()} of {page.total.toLocaleString()}
            </span>
            <span className="pager-controls">
              {page.page > 1
                ? <Link href={href(page.page - 1, action)} className="adm-btn">Previous</Link>
                : <span className="adm-btn" aria-disabled="true" style={{ opacity: 0.45 }}>Previous</span>}
              <span className="pager-meta">Page {page.page} of {lastPage}</span>
              {page.page < lastPage
                ? <Link href={href(page.page + 1, action)} className="adm-btn">Next</Link>
                : <span className="adm-btn" aria-disabled="true" style={{ opacity: 0.45 }}>Next</span>}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
