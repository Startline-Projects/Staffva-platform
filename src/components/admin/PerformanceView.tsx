import Link from "next/link";
import { type PerformanceReport } from "@/lib/adminPerformance";
import { DORMANT_AFTER_DAYS } from "@/lib/adminAlerts";
import DrainQueueButton from "@/components/admin/DrainQueueButton";

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "never";

function seenTone(days: number | null): string {
  if (days === null) return "bad";
  if (days >= 90) return "bad";
  if (days >= DORMANT_AFTER_DAYS) return "warn";
  return "";
}

export default function PerformanceView({ report }: { report: PerformanceReport }) {
  const { specialists, totals, internal } = report;
  const withQueue = specialists.filter((s) => s.assigned > 0);

  return (
    <div className="adm-col" style={{ maxWidth: 1080 }}>
      <div className="adm-page-header">
        <div>
          <div className="adm-eyebrow">Internal</div>
          <h1>Who is carrying <span className="adm-serif-italic">the work.</span></h1>
          <div className="adm-subhead">
            <strong>{totals.assigned.toLocaleString()}</strong> candidates assigned
            <span className="sep">·</span>
            {withQueue.length} of {specialists.length} specialists hold a queue
          </div>
        </div>
      </div>

      {totals.assignedToDormant > 0 && (
        <div className="prof-banner danger">
          <span className="prof-banner-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          </span>
          <div className="prof-banner-body">
            <div className="prof-banner-title">
              {totals.assignedToDormant.toLocaleString()} candidates are assigned to someone who has not signed in
            </div>
            <div className="prof-banner-text">
              {totals.dormantSpecialists} of the {withQueue.length} specialists holding a queue have
              been away for {DORMANT_AFTER_DAYS} days or more. Routing keeps handing candidates to
              accounts nobody is using, and a candidate in one of those queues is waiting on a
              person who is not coming back to it. <strong>Move queue</strong> on any row below
              hands the whole queue to someone else in one decision.
            </div>
          </div>
        </div>
      )}

      <section className="rec-section">
        <div className="rec-section-head">
          <h2>Specialists</h2>
        </div>
        <div className="adm-panel">
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Specialist</th>
                  <th style={{ textAlign: "right" }}>Assigned</th>
                  <th style={{ textAlign: "right" }}>Categories</th>
                  <th style={{ textAlign: "right" }}>Messages</th>
                  <th style={{ textAlign: "right" }}>Moved away</th>
                  <th>Last sign-in</th>
                  <th style={{ textAlign: "right" }}>Record</th>
                </tr>
              </thead>
              <tbody>
                {specialists.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="user-cell-text">
                        <span className="name">{s.name}</span>
                        <span className="user-cell-email">
                          {s.role === "recruiting_manager" ? "recruiting manager" : "talent specialist"}
                          {!s.isActive && " · inactive"}
                        </span>
                      </div>
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>{s.assigned || "—"}</td>
                    <td className="num" style={{ textAlign: "right" }}>{s.categories || "—"}</td>
                    <td className="num" style={{ textAlign: "right" }}>{s.messagesSent || "—"}</td>
                    <td className="num" style={{ textAlign: "right" }}>{s.reassignedAway || "—"}</td>
                    <td className={`num ${seenTone(s.daysSinceSignIn)}`}>
                      {fmtDate(s.lastSignInAt)}
                      {s.daysSinceSignIn !== null && s.daysSinceSignIn >= DORMANT_AFTER_DAYS && (
                        <div className="rec-note-line">{s.daysSinceSignIn} days ago</div>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="adm-row-actions">
                        {/* Only where there is something to move and nobody
                            moving it. A queue on someone who signs in is
                            theirs to work, not an admin's to redistribute. */}
                        {s.assigned > 0 && seenTone(s.daysSinceSignIn) !== "" && (
                          <DrainQueueButton from={s} specialists={specialists} />
                        )}
                        <Link href={`/admin/recruiters/${s.id}`} className="row-link">Open</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="staff-legend" style={{ marginTop: 12 }}>
          These are the four things this database can actually say about a specialist. There is no
          throughput column and no time-to-decision, because nothing records who moved a candidate
          through a stage — <code>candidate_status_events.actor_id</code> is null on all 445 of its
          rows. That gap is what the{" "}
          <Link href="/admin/audit" className="row-link">audit log</Link> was built to close; it
          will answer this for decisions taken from now on, not for the ones already made.
        </p>
      </section>

      <section className="rec-section">
        <div className="rec-section-head"><h2>Team communication</h2></div>
        <div className="rec-grid">
          <div className="rec-field">
            <div className="rec-k">Internal threads</div>
            <div className={`rec-v${internal.threads === null ? " mute" : ""}`}>{internal.threads ?? "could not be read"}</div>
          </div>
          <div className="rec-field">
            <div className="rec-k">Internal messages</div>
            <div className={`rec-v${internal.messages === null ? " mute" : ""}`}>{internal.messages ?? "could not be read"}</div>
          </div>
          <div className="rec-field">
            <div className="rec-k">Thread memberships</div>
            <div className={`rec-v${internal.members === null ? " mute" : ""}`}>{internal.members ?? "could not be read"}</div>
          </div>
          <div className="rec-field">
            <div className="rec-k">Messages to candidates</div>
            <div className="rec-v">{totals.messagesSent}</div>
          </div>
        </div>
        <p className="staff-legend" style={{ marginTop: 12 }}>
          Internal threads live in{" "}
          <Link href="/admin/team" className="row-link">Team Inbox</Link>. Messages to candidates go
          through each specialist&apos;s own queue and are counted per person above.
        </p>
      </section>
    </div>
  );
}
