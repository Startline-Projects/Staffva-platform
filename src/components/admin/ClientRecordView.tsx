import Link from "next/link";
import type { ClientRecord } from "@/lib/adminPeople";

/**
 * The client record. Deliberately quiet about how little is on it: most of
 * `clients`' optional columns have never been written by anything, and a grid
 * of "not on file" would read as twenty-four incomplete profiles rather than
 * as five columns nothing fills in.
 */

const fmtDate = (v: unknown): string | null =>
  typeof v === "string" && v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function initials(name: string, email: string): string {
  const src = name || email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

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

export default function ClientRecordView({ record }: { record: ClientRecord }) {
  const { c, lastSignInAt, engagements, jobPosts, profileViews, shortlists, unusedAcrossPlatform } = record;

  const name = c.full_name || "—";
  const activeEngagements = engagements.filter((e) => e.status === "active").length;
  const fees = engagements.reduce((s, e) => s + (e.platformFeeUsd ?? 0), 0);
  const card = c.payment_method_id
    ? `${c.payment_method_brand ?? "card"} ···· ${c.payment_method_last4 ?? "????"}`
    : null;

  return (
    <div className="adm-col" style={{ maxWidth: 1000 }}>
      <Link href="/admin/users?tab=clients" className="rec-back">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        All clients
      </Link>

      <div className="rec-hero">
        <div className="rec-hero-top">
          <div className="rec-photo">{initials(name, c.email || "")}</div>
          <div style={{ minWidth: 0 }}>
            <h1 className="rec-title">
              {name}
              {activeEngagements > 0
                ? <span className="adm-pill ok">Hiring</span>
                : <span className="adm-pill mute">No engagements</span>}
            </h1>
            <div className="rec-sub">
              <span>{c.email || "no email"}</span>
              <span className="sep">·</span>
              <span>{c.company_name || "no company on file"}</span>
              {c.timezone && <><span className="sep">·</span><span>{c.timezone}</span></>}
            </div>
          </div>
          <div className="rec-actionbar">
            {c.stripe_customer_id && (
              <Link
                href={`https://dashboard.stripe.com/customers/${c.stripe_customer_id}`}
                className="adm-btn"
                target="_blank"
                rel="noreferrer"
              >
                Open in Stripe
              </Link>
            )}
          </div>
        </div>

        <div className="rec-facts">
          <div className="rec-fact">
            <div className="rec-k">Active engagements</div>
            <div className="rec-v">{activeEngagements}</div>
          </div>
          <div className="rec-fact">
            <div className="rec-k">Platform fees</div>
            <div className="rec-v">${Math.round(fees).toLocaleString()}</div>
          </div>
          <div className="rec-fact">
            <div className="rec-k">Signed up</div>
            <div className="rec-v">{fmtDate(c.created_at) ?? "—"}</div>
          </div>
          <div className="rec-fact">
            <div className="rec-k">Last sign-in</div>
            <div className="rec-v">{fmtDate(lastSignInAt) ?? "never"}</div>
          </div>
        </div>
      </div>

      <section className="rec-section">
        <div className="rec-section-head"><h2>Account</h2></div>
        <div className="rec-grid">
          <Field k="Identity check" v={c.id_verification_status} tone={c.id_verification_status === "verified" ? "ok" : "warn"} note={fmtDate(c.id_verification_verified_at)} />
          <Field k="Payment method" v={card} note={card ? fmtDate(c.payment_method_added_at) : "no card on file"} />
          <Field k="Stripe customer" v={c.stripe_customer_id} mono />
          <Field k="Transcript access" v={c.transcript_access_status} note={fmtDate(c.transcript_access_until)} />
          <Field k="Time zone" v={c.timezone} mono />
          <Field k="Joined" v={fmtDate(c.created_at)} />
        </div>
      </section>

      <section className="rec-section">
        <div className="rec-section-head">
          <h2>Activity</h2>
        </div>
        <div className="rec-grid" style={{ marginBottom: 12 }}>
          <Field k="Engagements" v={engagements.length} mono note={engagements.length ? engagements.map((e) => e.status).join(", ") : null} />
          <Field k="Job posts" v={jobPosts.length} mono />
          <Field k="Candidate profiles viewed" v={num(profileViews)} mono />
          <Field k="Shortlists" v={num(shortlists)} mono />
        </div>

        {jobPosts.length > 0 && (
          <div className="adm-panel">
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead><tr><th>Job post</th><th>Status</th><th>Posted</th></tr></thead>
                <tbody>
                  {jobPosts.map((j) => (
                    <tr key={j.id}>
                      <td className="name">{j.title || "untitled"}</td>
                      <td>{j.status ?? "—"}</td>
                      <td className="num">{fmtDate(j.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {engagements.length === 0 && jobPosts.length === 0 && (
          <div className="rec-empty">
            This client has signed up but has not posted a job or started an engagement.
            {profileViews > 0 ? ` They have looked at ${profileViews} candidate ${profileViews === 1 ? "profile" : "profiles"}.` : " They have not viewed any candidate profiles."}
          </div>
        )}
      </section>

      <section className="rec-section">
        <div className="rec-section-head"><h2>Profile</h2></div>
        {unusedAcrossPlatform.length > 0 && (
          <div className="rec-empty" style={{ marginBottom: 12 }}>
            <strong>{unusedAcrossPlatform.join(", ")}</strong>{" "}
            {unusedAcrossPlatform.length === 1 ? "is a column that is" : "are columns that are"} empty for
            every client on the platform — nothing in the product writes{" "}
            {unusedAcrossPlatform.length === 1 ? "it" : "them"} yet. Their absence here says nothing
            about this client.
          </div>
        )}
        <div className="rec-grid">
          <Field k="Company" v={c.company_name} />
          <Field k="Website" v={c.website_url ? <Link href={c.website_url} className="row-link" target="_blank" rel="noreferrer">Open</Link> : null} />
          <Field k="Headline" v={c.headline} />
          <Field k="Referral source" v={c.referral_source} />
        </div>
        {c.bio && (
          <div className="rec-panel" style={{ marginTop: 12 }}>
            <div className="rec-panel-label">Bio</div>
            <div className="rec-prose">{c.bio}</div>
          </div>
        )}
      </section>
    </div>
  );
}
