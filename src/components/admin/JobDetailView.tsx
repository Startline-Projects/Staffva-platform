import Link from "next/link";
import Fig from "@/components/admin/Fig";
import type { JobDetail } from "@/lib/adminJobs";

const fmtDate = (v: unknown) =>
  typeof v === "string" && v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

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

function Chips({ value }: { value: unknown }) {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
      : [];
  if (!list.length) return <span className="rec-v empty">not on file</span>;
  return (
    <div className="rec-chips">
      {list.slice(0, 40).map((s, i) => <span key={i} className="rec-chip">{typeof s === "string" ? s : JSON.stringify(s)}</span>)}
    </div>
  );
}

export default function JobDetailView({ record }: { record: JobDetail }) {
  const { j, title, status, clientId, clientName, roleCategory, budgetLabel, hoursLabel, matches } = record;

  return (
    <div className="adm-col" style={{ maxWidth: 980 }}>
      <Link href="/admin/jobs" className="rec-back">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        All postings
      </Link>

      <div className="rec-hero">
        <div className="rec-hero-top">
          <div className="rec-photo" style={{ background: "linear-gradient(135deg, #C9B48A, #6B5A3C)" }} aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="7" width="19" height="13" rx="2" /><path d="M16 20V5.5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2V20" /></svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="rec-title">
              {title || "Untitled posting"}
              <span className={`adm-pill ${status === "active" ? "ok" : status === "draft" ? "warn" : "mute"}`}>{status}</span>
            </h1>
            <div className="rec-sub">
              <span>{roleCategory ?? "no role category"}</span>
              <span className="sep">·</span>
              <span>
                {clientId
                  ? <Link href={`/admin/clients/${clientId}`} className="row-link">{clientName ?? "open client"}</Link>
                  : (clientName ?? "no client")}
              </span>
            </div>
          </div>
        </div>

        <div className="rec-facts">
          <div className="rec-fact"><div className="rec-k">Pay</div><div className="rec-v">{budgetLabel ?? "—"}</div></div>
          <div className="rec-fact"><div className="rec-k">Hours</div><div className="rec-v">{hoursLabel ?? "—"}</div></div>
          <div className="rec-fact"><div className="rec-k">Matches</div><div className="rec-v"><Fig n={matches} /></div></div>
          <div className="rec-fact"><div className="rec-k">Posted</div><div className="rec-v">{fmtDate(j.published_at ?? j.created_at) ?? "—"}</div></div>
        </div>
      </div>

      <section className="rec-section">
        <div className="rec-section-head"><h2>Terms</h2></div>
        <div className="rec-grid">
          <Field k="Rate type" v={j.rate_type} />
          <Field k="Hourly min" v={j.hourly_rate_min !== null && j.hourly_rate_min !== undefined ? `$${Number(j.hourly_rate_min).toLocaleString()}` : null} mono />
          <Field k="Hourly max" v={j.hourly_rate_max !== null && j.hourly_rate_max !== undefined ? `$${Number(j.hourly_rate_max).toLocaleString()}` : null} mono />
          <Field k="Fixed budget" v={j.fixed_budget !== null && j.fixed_budget !== undefined ? `$${Number(j.fixed_budget).toLocaleString()}` : null} mono />
          <Field k="Budget range" v={j.budget_range} note={j.budget_range ? "older free-text field" : null} />
          <Field k="Hours per week" v={j.hours_per_week_estimate ?? j.hours_per_week ?? null} mono />
          <Field k="Duration" v={[j.duration_type, j.duration_estimate].filter(Boolean).join(" · ") || null} />
          <Field k="Experience level" v={j.experience_level} />
          <Field k="Start date" v={fmtDate(j.start_date)} />
          <Field k="Published" v={fmtDate(j.published_at)} />
        </div>
      </section>

      <section className="rec-section">
        <div className="rec-section-head"><h2>The ask</h2></div>
        {j.summary && (
          <div className="rec-panel"><div className="rec-panel-label">Summary</div><div className="rec-prose">{j.summary}</div></div>
        )}
        <div className="rec-panel">
          <div className="rec-panel-label">Description</div>
          {j.description ? <div className="rec-prose">{j.description}</div> : <div className="rec-v empty">not on file</div>}
        </div>
        {j.responsibilities && (
          <div className="rec-panel"><div className="rec-panel-label">Responsibilities</div><div className="rec-prose">{typeof j.responsibilities === "string" ? j.responsibilities : JSON.stringify(j.responsibilities, null, 2)}</div></div>
        )}
        <div className="rec-panel">
          <div className="rec-panel-label">Must have</div>
          <Chips value={j.must_have_skills} />
        </div>
        <div className="rec-panel">
          <div className="rec-panel-label">Nice to have</div>
          <Chips value={j.nice_to_have_skills} />
        </div>
        {j.custom_role_description && (
          <div className="rec-panel"><div className="rec-panel-label">Custom role description</div><div className="rec-prose">{j.custom_role_description}</div></div>
        )}
        {j.ai_brief && (
          <div className="rec-panel"><div className="rec-panel-label">AI brief</div><div className="rec-prose">{typeof j.ai_brief === "string" ? j.ai_brief : JSON.stringify(j.ai_brief, null, 2)}</div></div>
        )}
      </section>
    </div>
  );
}
