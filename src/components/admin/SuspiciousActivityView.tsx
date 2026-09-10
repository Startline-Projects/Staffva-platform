import Link from "next/link";
import type { SafetyReport } from "@/lib/adminSafety";

const STATUS_LABEL: Record<string, string> = {
  approved: "Live", active: "Applying", pending_review: "In review",
  profile_review: "Profile review", rejected: "Rejected",
};

export default function SuspiciousActivityView({ report }: { report: SafetyReport }) {
  const { candidates, totals, actions } = report;
  const nothingEverActioned =
    actions.bansEverRequested === 0 && actions.rejections === 0 &&
    actions.lockoutsEver === 0 && actions.suspendedStaff === 0;

  return (
    <div className="adm-col" style={{ maxWidth: 1040 }}>
      <div className="adm-page-header">
        <div>
          <div className="adm-eyebrow">Trust &amp; safety</div>
          <h1>Signals, and what they&apos;re <span className="adm-serif-italic">worth.</span></h1>
          <div className="adm-subhead">
            <strong>{totals.withAnySignal}</strong> of {totals.candidates.toLocaleString()} candidates carry a signal
            <span className="sep">·</span>
            {totals.liveWithAnySignal} of those are live
          </div>
        </div>
      </div>

      <p className="staff-legend">
        StaffVA has no fraud-alert table and no security-incident table. These are the three things
        it does record. Two of them are weaker than their names suggest, and that caveat is printed
        next to the number rather than left for someone to discover.
      </p>

      {totals.liveWithAnySignal > 0 && nothingEverActioned && (
        <div className="prof-banner">
          <span className="prof-banner-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21.5s7.5-3.8 7.5-9.5V5.2L12 2.5 4.5 5.2V12c0 5.7 7.5 9.5 7.5 9.5z" /><path d="M12 9v4M12 16.2v.1" /></svg>
          </span>
          <div className="prof-banner-body">
            <div className="prof-banner-title">
              Every flagged candidate is live, and nothing has ever been actioned
            </div>
            <div className="prof-banner-text">
              {totals.liveWithAnySignal} candidates carrying an integrity signal are in the
              marketplace. No ban has ever been requested, no application rejected, no test lockout
              applied. Given what the two signals below actually measure, that may be the right
              outcome — but it is an outcome nobody chose.
            </div>
          </div>
        </div>
      )}

      {/* ── Signal 1 ── */}
      <section className="rec-section">
        <div className="rec-section-head">
          <h2>
            Test-window exits
            <span className="count">{totals.windowExitEvents} events · {totals.withWindowExits} candidates</span>
          </h2>
        </div>
        <div className="rec-empty" style={{ marginBottom: 12 }}>
          <strong>This counts the mouse leaving the window during the English test.</strong> It is
          the only event type in <code>cheat_log</code> — there is no tab-switch or fullscreen-exit
          data behind these numbers, despite the logger accepting both. A pointer leaving a browser
          window is weak evidence on its own, and the client code notes that mobile browsers fire it
          spuriously, logging those without counting them.
        </div>
      </section>

      {/* ── Signal 2 ── */}
      <section className="rec-section">
        <div className="rec-section-head">
          <h2>
            &ldquo;Score mismatch&rdquo;
            <span className="count">{totals.withScoreMismatch} candidates</span>
          </h2>
        </div>
        <div className="rec-empty" style={{ marginBottom: 12 }}>
          <strong>This flag does not compare two scores.</strong>{" "}
          <code>gradeAttempt.ts</code> sets it with <code>score_mismatch_flag: overall &gt; 80</code>,
          so it marks the strongest candidates and nothing else. The name is the only part of it
          that suggests fraud. Treat a mismatch here as &ldquo;scored above 80&rdquo; until the
          check is rewritten to compare something.
        </div>
      </section>

      {/* ── Signal 3 ── */}
      <section className="rec-section">
        <div className="rec-section-head">
          <h2>
            Rate limiting
            <span className="count">{totals.rateLimitHits} hits · {totals.rateLimitBuckets} buckets</span>
          </h2>
        </div>
        <div className="rec-empty">
          <code>rate_limit_hits</code> counts per bucket and window, not per person, so it cannot be
          attributed to a candidate. It is here as a platform-level number and no more.
        </div>
      </section>

      {/* ── Who ── */}
      <section className="rec-section">
        <div className="rec-section-head">
          <h2>
            Candidates carrying a signal
            <span className="count">{candidates.length}</span>
          </h2>
        </div>
        {candidates.length === 0 ? (
          <div className="adm-state">
            No candidate carries either signal. The query succeeded — this is genuinely empty.
          </div>
        ) : (
          <div className="adm-panel">
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Window exits</th>
                    <th style={{ textAlign: "right" }}>Flag count</th>
                    <th>Scored above 80</th>
                    <th style={{ textAlign: "right" }}>Record</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className="user-cell-text">
                          <span className="name">{c.name}</span>
                          <span className="user-cell-email">{c.email ?? "no email"}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`adm-pill ${c.adminStatus === "approved" ? "ok" : "mute"}`}>
                          {STATUS_LABEL[c.adminStatus ?? ""] ?? c.adminStatus ?? "—"}
                        </span>
                      </td>
                      <td className="num" style={{ textAlign: "right" }}>{c.windowExits || "—"}</td>
                      <td className="num" style={{ textAlign: "right" }}>{c.cheatFlagCount || "—"}</td>
                      <td>{c.scoreMismatch ? "yes" : "—"}</td>
                      <td style={{ textAlign: "right" }}>
                        <Link href={`/admin/candidates/${c.id}`} className="row-link">Open</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ── What has ever been done ── */}
      <section className="rec-section">
        <div className="rec-section-head"><h2>Enforcement on record</h2></div>
        <div className="rec-grid">
          <div className="rec-field"><div className="rec-k">Bans awaiting a ruling</div><div className="rec-v">{actions.bansPending}</div></div>
          <div className="rec-field"><div className="rec-k">Bans ever requested</div><div className="rec-v">{actions.bansEverRequested}</div></div>
          <div className="rec-field"><div className="rec-k">Applications rejected</div><div className="rec-v">{actions.rejections}</div></div>
          <div className="rec-field"><div className="rec-k">Appeals filed</div><div className="rec-v">{actions.appeals}</div></div>
          <div className="rec-field"><div className="rec-k">Test lockouts now</div><div className="rec-v">{actions.lockoutsNow}</div></div>
          <div className="rec-field"><div className="rec-k">Test lockouts ever</div><div className="rec-v">{actions.lockoutsEver}</div></div>
          <div className="rec-field"><div className="rec-k">Suspended staff accounts</div><div className="rec-v">{actions.suspendedStaff}</div></div>
        </div>
        <p className="staff-legend" style={{ marginTop: 12 }}>
          Pending bans are ruled on from{" "}
          <Link href="/pending-bans" className="row-link">Pending Bans</Link>; a lockout is lifted
          from <Link href="/admin/lockouts" className="row-link">Lockouts</Link>. Neither of those
          records who took the decision — see the note on any candidate&apos;s history.
        </p>
      </section>
    </div>
  );
}
