import Link from "next/link";
import type { JobRow } from "@/lib/adminJobs";

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

const STATUS_TONE: Record<string, string> = { active: "ok", filled: "mute", closed: "mute", draft: "warn" };

export default function JobListView({ rows }: { rows: JobRow[] }) {
  const active = rows.filter((r) => r.status === "active").length;
  const untitled = rows.filter((r) => !r.title).length;

  return (
    <div className="adm-col">
      <div className="adm-page-header">
        <div>
          <div className="adm-eyebrow">Operations</div>
          <h1>What clients are <span className="adm-serif-italic">asking for.</span></h1>
          <div className="adm-subhead">
            <strong>{rows.length}</strong> {rows.length === 1 ? "posting" : "postings"}
            <span className="sep">·</span>
            {active} active
          </div>
        </div>
      </div>

      {rows.length > 0 ? (
        <>
          <div className="adm-panel">
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Posting</th>
                    <th>Client</th>
                    <th>Role</th>
                    <th>Pay</th>
                    <th>Hours</th>
                    <th style={{ textAlign: "right" }}>Matches</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Posted</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="name">
                        <Link href={`/admin/jobs/${r.id}`} className="row-link">
                          {r.title || "untitled posting"}
                        </Link>
                      </td>
                      <td>
                        {r.clientId
                          ? <Link href={`/admin/clients/${r.clientId}`} className="row-link">{r.clientName ?? "—"}</Link>
                          : (r.clientName ?? "—")}
                      </td>
                      <td>{r.roleCategory ?? "—"}</td>
                      <td className="num">{r.budgetLabel ?? "—"}</td>
                      <td className="num">{r.hoursLabel ?? "—"}</td>
                      <td className="num" style={{ textAlign: "right" }}>{r.matches}</td>
                      <td><span className={`adm-pill ${STATUS_TONE[r.status] ?? "mute"}`}>{r.status}</span></td>
                      <td className="num" style={{ textAlign: "right" }}>{fmtDate(r.publishedAt ?? r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {untitled > 0 && (
            <p className="staff-legend" style={{ marginTop: 14 }}>
              {untitled === rows.length
                ? `Neither the title nor a summary was captured on ${untitled === 1 ? "this posting" : "these postings"} — the column is null, so the row is listed by its role category instead.`
                : `${untitled} of these postings has no title on record and is listed by role category instead.`}
            </p>
          )}
        </>
      ) : (
        <div className="adm-state">
          No client has posted a job yet. This reads the <code>job_posts</code> table directly — an
          empty list here means the table is empty, not that a query failed.
        </div>
      )}
    </div>
  );
}
