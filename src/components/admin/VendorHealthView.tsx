import type { PlatformReport } from "@/lib/adminPlatform";

const fmtDateTime = (v: string | null) =>
  v ? new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

/** What each vendor's absence actually costs, so a red row means something. */
const VENDOR_ROLE: Record<string, string> = {
  anthropic: "Contract generation, candidate insights, role classification and job matching all call it.",
  elevenlabs: "Speech for the AI interview.",
  deepgram: "Transcription for the AI interview.",
};

export default function VendorHealthView({ report }: { report: PlatformReport }) {
  const { vendors, totalFailures, outbox, outboxOldestUnsent, recentFailures } = report;
  const down = vendors.filter((v) => !v.ok);

  return (
    <div className="adm-col" style={{ maxWidth: 1040 }}>
      <div className="adm-page-header">
        <div>
          <div className="adm-eyebrow">Platform</div>
          <h1>What we depend <span className="adm-serif-italic">on.</span></h1>
          <div className="adm-subhead">
            <strong>{vendors.length}</strong> {vendors.length === 1 ? "vendor" : "vendors"} checked
            <span className="sep">·</span>
            {down.length === 0 ? "all up" : `${down.length} down`}
            <span className="sep">·</span>
            {totalFailures.toLocaleString()} failures on record
          </div>
        </div>
      </div>

      {down.map((v) => {
        const days = v.daysFailing;
        return (
          <div key={v.vendor} className="prof-banner danger">
            <span className="prof-banner-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16.2v.1" /></svg>
            </span>
            <div className="prof-banner-body">
              <div className="prof-banner-title">
                {v.vendor} is down{days !== null && days >= 1 ? ` — and has been for ${days} ${days === 1 ? "day" : "days"}` : ""}
              </div>
              <div className="prof-banner-text">
                {VENDOR_ROLE[v.vendor] ? `${VENDOR_ROLE[v.vendor]} ` : ""}
                {v.fatalFailures.toLocaleString()} fatal {v.fatalFailures === 1 ? "failure" : "failures"} recorded
                {v.firstFailureAt ? ` since ${fmtDate(v.firstFailureAt)}` : ""}.
                {v.detail ? <> Last check said: <code>{v.detail.slice(0, 220)}</code></> : null}
              </div>
            </div>
          </div>
        );
      })}

      <section className="rec-section">
        <div className="rec-section-head"><h2>Vendors</h2></div>
        <div className="adm-panel">
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Status</th>
                  <th>Last check</th>
                  <th style={{ textAlign: "right" }}>Latency</th>
                  <th style={{ textAlign: "right" }}>Failures</th>
                  <th>Failing since</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.vendor}>
                    <td className="name">
                      {v.vendor}
                      {VENDOR_ROLE[v.vendor] && <div className="rec-note-line">{VENDOR_ROLE[v.vendor]}</div>}
                    </td>
                    <td><span className={`adm-pill ${v.ok ? "ok" : "bad"}`}>{v.ok ? "up" : "down"}</span></td>
                    <td className="num">{fmtDateTime(v.checkedAt)}</td>
                    <td className="num" style={{ textAlign: "right" }}>{v.durationMs === null ? "—" : `${v.durationMs} ms`}</td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {v.failures.toLocaleString()}
                      {v.fatalFailures > 0 && <div className="rec-note-line" style={{ color: "var(--danger)" }}>{v.fatalFailures.toLocaleString()} fatal</div>}
                    </td>
                    <td className="num">{v.ok ? "—" : fmtDate(v.firstFailureAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="staff-legend" style={{ marginTop: 12 }}>
          Status is the last row in <code>vendor_health</code>; the failure counts come from{" "}
          <code>vendor_failures</code>, which is what turns &ldquo;down right now&rdquo; into
          &ldquo;down since the 26th&rdquo;. A vendor with no recorded failure has simply never
          failed a check.
        </p>
      </section>

      <section className="rec-section">
        <div className="rec-section-head"><h2>Email outbox</h2></div>
        {outbox.length === 0 ? (
          <div className="adm-state">The outbox is empty. Nothing is queued and nothing has been sent.</div>
        ) : (
          <>
            <div className="rec-grid">
              {outbox.map((o) => (
                <div key={o.status} className="rec-field">
                  <div className="rec-k">{o.status}</div>
                  <div className={`rec-v${o.status !== "sent" ? " warn" : ""}`}>{o.count.toLocaleString()}</div>
                </div>
              ))}
            </div>
            {outboxOldestUnsent && (
              <p className="staff-legend" style={{ marginTop: 12 }}>
                The oldest unsent message has been queued since {fmtDateTime(outboxOldestUnsent)}.
                Mail leaves through a drain cron, so a backlog here usually means the cron is not
                running rather than that the provider is refusing.
              </p>
            )}
          </>
        )}
      </section>

      <section className="rec-section">
        <div className="rec-section-head">
          <h2>
            Most recent failures
            <span className="count">last {recentFailures.length}</span>
          </h2>
        </div>
        {recentFailures.length === 0 ? (
          <div className="adm-state">No vendor call has ever failed.</div>
        ) : (
          <div className="adm-panel">
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Vendor</th>
                    <th>Operation</th>
                    <th style={{ textAlign: "right" }}>Code</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {recentFailures.map((f) => (
                    <tr key={f.id}>
                      <td className="num" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(f.occurredAt)}</td>
                      <td className="name">{f.vendor}</td>
                      <td className="num">{f.operation ?? "—"}</td>
                      <td className="num" style={{ textAlign: "right" }}>{f.statusCode ?? "—"}</td>
                      <td>
                        {f.fatal && <span className="adm-pill bad" style={{ marginRight: 8 }}>fatal</span>}
                        {f.message ? f.message.slice(0, 160) : <span className="rec-v empty" style={{ fontSize: 12 }}>no message</span>}
                      </td>
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
