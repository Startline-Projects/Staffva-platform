import Fig from "@/components/admin/Fig";
import Link from "next/link";
import type { SpecialistRecord } from "@/lib/adminPeople";

/**
 * The talent-specialist record.
 *
 * The interesting part is the queue, because StaffVA decides "whose queue is
 * this candidate in" two different ways: `candidates.assigned_recruiter`
 * points at a person, and `recruiter_assignments` claims whole role
 * categories. Both are populated and they do not describe the same set. The
 * record shows each with its own name rather than picking one and calling it
 * "the queue".
 */

const fmtDate = (v: unknown): string | null =>
  typeof v === "string" && v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

function initials(name: string | null, email: string): string {
  const src = (name || "").trim() || email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const STATUS_LABEL: Record<string, string> = {
  live: "Live",
  approved: "Live",
  revision_required: "Revisions asked",
  active: "Applying",
  pending_review: "In review",
  profile_review: "Profile review",
  pending_2nd_interview: "2nd interview",
  rejected: "Rejected",
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

export default function SpecialistRecordView({ record }: { record: SpecialistRecord }) {
  const { p, lastSignInAt, mfaFactors, directQueue, categories, categoryQueueTotal, messagesSent } = record;

  const name = p.full_name || p.email;
  const isManager = p.role === "recruiting_manager";
  const suspended = Boolean(p.suspended_at);

  const statusRows = Object.entries(directQueue.byStatus).sort((a, b) => b[1] - a[1]);
  const tagRows = Object.entries(directQueue.byScreeningTag).sort((a, b) => b[1] - a[1]);

  return (
    <div className="adm-col" style={{ maxWidth: 1000 }}>
      <Link href="/admin/recruiters" className="rec-back">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        All specialists
      </Link>

      <div className="rec-hero">
        <div className="rec-hero-top">
          <div className="rec-photo">
            {p.recruiter_photo_url
              /* eslint-disable-next-line @next/next/no-img-element */
              ? <img src={p.recruiter_photo_url} alt="" />
              : initials(p.full_name, p.email)}
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="rec-title">
              {name}
              <span className={`adm-pill ${suspended ? "bad" : p.is_active ? "ok" : "warn"}`}>
                {suspended ? "Suspended" : p.is_active ? "Active" : "Inactive"}
              </span>
            </h1>
            <div className="rec-sub">
              <span>{p.email}</span>
              <span className="sep">·</span>
              <span>{isManager ? "Recruiting manager" : "Talent specialist"}</span>
              {p.recruiter_type && <><span className="sep">·</span><span>{p.recruiter_type}</span></>}
            </div>
          </div>
        </div>

        <div className="rec-facts">
          <div className="rec-fact">
            <div className="rec-k">Assigned candidates</div>
            <div className="rec-v">{directQueue.total}</div>
          </div>
          <div className="rec-fact">
            <div className="rec-k">Categories claimed</div>
            <div className="rec-v">{categories.length}</div>
          </div>
          <div className="rec-fact">
            <div className="rec-k">Last sign-in</div>
            <div className="rec-v">{fmtDate(lastSignInAt) ?? "never"}</div>
          </div>
          <div className="rec-fact">
            <div className="rec-k">Two-factor</div>
            <div className={`rec-v${mfaFactors === 0 ? " warn" : ""}`}>
              {mfaFactors === null ? "unknown" : mfaFactors > 0 ? `on · ${mfaFactors}` : "off"}
            </div>
          </div>
        </div>
      </div>

      {/* The two-sources problem, stated only when the numbers actually differ. */}
      {/* `null !== 5` is true. Without the null check an unread count would
          raise this banner — a warning that two mechanisms disagree, produced
          by one of them not answering. */}
      {categories.length > 0 && categoryQueueTotal !== null && categoryQueueTotal !== directQueue.total && (
        <div className="prof-banner info">
          <span className="prof-banner-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 16v-5M12 8.2v.1" /></svg>
          </span>
          <div className="prof-banner-body">
            <div className="prof-banner-title">Two different answers to &ldquo;whose queue is this&rdquo;</div>
            <div className="prof-banner-text">
              <strong>{directQueue.total}</strong> candidates name this person in{" "}
              <code>candidates.assigned_recruiter</code>, while{" "}
              <strong><Fig n={categoryQueueTotal} /></strong> sit in the role categories claimed through{" "}
              <code>recruiter_assignments</code>. Both mechanisms are live and they do not describe
              the same set — the specialists list is built from the second, this record leads with
              the first.
            </div>
          </div>
        </div>
      )}

      <section className="rec-section">
        <div className="rec-section-head"><h2>Account</h2></div>
        <div className="rec-grid">
          <Field k="Role" v={isManager ? "Recruiting manager" : "Talent specialist"} />
          <Field k="Specialist type" v={p.recruiter_type} />
          <Field k="Daily interview target" v={p.daily_interview_target ?? null} mono />
          <Field k="Joined" v={fmtDate(p.created_at)} />
          <Field k="Last sign-in" v={fmtDate(lastSignInAt)} />
          <Field k="Suspended" v={p.suspended_at ? fmtDate(p.suspended_at) : "No"} tone={suspended ? "bad" : undefined} />
        </div>
        {p.bio && (
          <div className="rec-panel" style={{ marginTop: 12 }}>
            <div className="rec-panel-label">Bio</div>
            <div className="rec-prose">{p.bio}</div>
          </div>
        )}
      </section>

      <section className="rec-section">
        <div className="rec-section-head">
          <h2>
            Assigned queue
            <span className="count">{directQueue.total} candidates</span>
          </h2>
        </div>

        {directQueue.total > 0 ? (
          <>
            <div className="rec-grid" style={{ marginBottom: 12 }}>
              {statusRows.map(([status, n]) => (
                <Field key={status} k={STATUS_LABEL[status] ?? status} v={n} mono />
              ))}
            </div>

            {tagRows.length > 0 && (
              <div className="rec-panel" style={{ marginBottom: 12 }}>
                <div className="rec-panel-label">Screening tags</div>
                <div className="rec-chips">
                  {tagRows.map(([tag, n]) => (
                    <span key={tag} className="rec-chip">{tag} · {n}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="adm-panel">
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead><tr><th>Most recent</th><th>Status</th><th>Applied</th><th style={{ textAlign: "right" }}>Record</th></tr></thead>
                  <tbody>
                    {directQueue.recent.map((c) => (
                      <tr key={c.id}>
                        <td className="name">{c.name}</td>
                        <td>{STATUS_LABEL[c.status ?? ""] ?? c.status ?? "—"}</td>
                        <td className="num">{fmtDate(c.createdAt)}</td>
                        <td style={{ textAlign: "right" }}>
                          <Link href={`/admin/candidates/${c.id}`} className="row-link">Open</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="rec-empty">
            No candidate names this specialist in <code>candidates.assigned_recruiter</code>.
            {categories.length > 0
              ? ` They do claim ${categories.length} role ${categories.length === 1 ? "category" : "categories"}, listed below.`
              : ""}
          </div>
        )}
      </section>

      <section className="rec-section">
        <div className="rec-section-head">
          <h2>
            Category claims
            {categories.length > 0 && <span className="count"><Fig n={categoryQueueTotal} /> candidates in scope</span>}
          </h2>
        </div>
        {categories.length > 0 ? (
          <div className="rec-panel">
            <div className="rec-chips">
              {categories.map((cat) => <span key={cat} className="rec-chip">{cat}</span>)}
            </div>
          </div>
        ) : (
          <div className="rec-empty">
            No rows in <code>recruiter_assignments</code> for this person, so they claim no role
            categories. Anything they work on reaches them by direct assignment.
          </div>
        )}
      </section>

      <section className="rec-section">
        <div className="rec-section-head"><h2>Communication</h2></div>
        <div className="rec-grid">
          <Field k="Messages sent to candidates" v={<Fig n={messagesSent} />} mono />
        </div>
      </section>
    </div>
  );
}
