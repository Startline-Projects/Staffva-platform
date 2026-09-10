import Link from "next/link";
import { DIMENSIONS, type Report } from "@/lib/adminReports";
import ReportCsvButton from "@/components/admin/ReportCsvButton";

const POP_LABEL: Record<string, string> = {
  candidates: "Candidates",
  clients: "Clients",
  engagements: "Engagements",
};

export default function ReportView({ report }: { report: Report }) {
  const { dimension, rows, total, missingCount, from, to } = report;
  const max = Math.max(...rows.map((r) => r.count), 1);
  const everythingMissing = total > 0 && missingCount === total;

  const grouped = Object.entries(
    DIMENSIONS.reduce<Record<string, typeof DIMENSIONS>>((acc, d) => {
      (acc[d.population] ??= []).push(d);
      return acc;
    }, {})
  );

  return (
    <div className="adm-col" style={{ maxWidth: 1040 }}>
      <div className="adm-page-header">
        <div>
          <div className="adm-eyebrow">Operations</div>
          <h1>What the numbers <span className="adm-serif-italic">actually say.</span></h1>
          <div className="adm-subhead">
            <strong>{total.toLocaleString()}</strong> {POP_LABEL[dimension.population].toLowerCase()} in scope
            {(from || to) && <><span className="sep">·</span>{from ?? "start"} → {to ?? "now"}</>}
          </div>
        </div>
      </div>

      <p className="staff-legend">
        Every dimension here is a column with data behind it. There is deliberately no revenue
        report: platform fees are recorded on engagements, but nothing on this platform has ever
        been funded or released, so a revenue chart would be a column of numbers nobody has been
        paid.
      </p>

      {/* Report picker — a GET form, so every report is a linkable URL. */}
      <form method="get" action="/admin/reports" className="rep-controls">
        <div className="rep-field">
          <label className="adm-field-label" htmlFor="d">Report</label>
          <select id="d" name="d" className="adm-select" defaultValue={dimension.id}>
            {grouped.map(([pop, dims]) => (
              <optgroup key={pop} label={POP_LABEL[pop] ?? pop}>
                {dims.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="rep-field">
          <label className="adm-field-label" htmlFor="from">From</label>
          <input id="from" name="from" type="date" className="adm-input" defaultValue={from ?? ""} />
        </div>
        <div className="rep-field">
          <label className="adm-field-label" htmlFor="to">To</label>
          <input id="to" name="to" type="date" className="adm-input" defaultValue={to ?? ""} />
        </div>
        <div className="rep-actions">
          <button type="submit" className="adm-btn primary">Run</button>
          {(from || to) && <Link href={`/admin/reports?d=${dimension.id}`} className="adm-btn">Clear dates</Link>}
        </div>
      </form>

      <section className="rec-section">
        <div className="rec-section-head">
          <h2>
            {dimension.label}
            <span className="count">{total.toLocaleString()} rows</span>
          </h2>
          <ReportCsvButton report={report} />
        </div>

        {total === 0 ? (
          <div className="adm-state">
            No {POP_LABEL[dimension.population].toLowerCase()} fall in that window. The query
            succeeded — this is an empty result, not a failed read.
          </div>
        ) : everythingMissing ? (
          <div className="rec-empty">
            <strong>All {total.toLocaleString()} rows have no value for{" "}
            <code>{dimension.column}</code>.</strong>{" "}
            The column is empty across the whole population, so there is nothing to break down. That
            is a fact about the data collection, not about the people in it.
          </div>
        ) : (
          <div className="adm-panel">
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Value</th>
                    <th style={{ width: "45%" }}>Share</th>
                    <th style={{ textAlign: "right" }}>Count</th>
                    <th style={{ textAlign: "right" }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.value}>
                      <td className={r.missing ? "" : "name"}>
                        {r.missing ? <span className="rec-v empty" style={{ fontSize: 12.5 }}>{r.value}</span> : r.value}
                      </td>
                      <td>
                        <div className="rep-bar-track">
                          <div
                            className={`rep-bar-fill${r.missing ? " missing" : ""}`}
                            style={{ width: `${(r.count / max) * 100}%` }}
                          />
                        </div>
                      </td>
                      <td className="num" style={{ textAlign: "right" }}>{r.count.toLocaleString()}</td>
                      <td className="num" style={{ textAlign: "right" }}>{(r.share * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {missingCount > 0 && !everythingMissing && (
          <p className="staff-legend" style={{ marginTop: 12 }}>
            {missingCount.toLocaleString()} of {total.toLocaleString()} rows have no value for{" "}
            <code>{dimension.column}</code> and are counted in their own line rather than dropped —
            leaving them out would make every percentage above overstate itself.
          </p>
        )}
      </section>
    </div>
  );
}
