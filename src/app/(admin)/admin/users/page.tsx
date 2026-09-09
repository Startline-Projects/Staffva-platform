import Link from "next/link";
import {
  PAGE_SIZE,
  POPULATIONS,
  loadCounts,
  loadDirectory,
  type Population,
} from "@/lib/adminUsers";

export const dynamic = "force-dynamic";

function isPopulation(v: string | undefined): v is Population {
  return POPULATIONS.some((p) => p.id === v);
}

function initials(name: string, email: string | null): string {
  const src = name.trim() === "—" ? (email || "") : name;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Keeps the search term when switching tab, but always restarts paging —
 *  page 7 of candidates is meaningless once you are looking at 4 admins. */
function tabHref(tab: Population, q: string): string {
  const p = new URLSearchParams({ tab });
  if (q) p.set("q", q);
  return `/admin/users?${p}`;
}

function pageHref(tab: Population, q: string, page: number): string {
  const p = new URLSearchParams({ tab });
  if (q) p.set("q", q);
  if (page > 1) p.set("page", String(page));
  return `/admin/users?${p}`;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const tab: Population = isPopulation(sp.tab) ? sp.tab : "candidates";
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const [counts, directory] = await Promise.all([loadCounts(), loadDirectory(tab, q, page)]);

  if (!counts || !directory) {
    return (
      <div className="adm-state error" role="alert">
        <strong>The directory could not be read.</strong>
        <p style={{ marginTop: 8 }}>
          One of the population queries failed. Reload; if it persists, check{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code>.
        </p>
      </div>
    );
  }

  const lastPage = Math.max(1, Math.ceil(directory.total / PAGE_SIZE));
  const showingFrom = directory.total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, directory.total);

  return (
    <div className="adm-col">
      <div className="adm-page-header">
        <div>
          <div className="adm-eyebrow">Directory</div>
          <h1>Everyone on <span className="adm-serif-italic">StaffVA.</span></h1>
          <div className="adm-subhead">
            <strong>{counts.total.toLocaleString()}</strong> accounts
            <span className="sep">·</span>
            {counts.candidates.toLocaleString()} candidates
            <span className="sep">·</span>
            {counts.clients.toLocaleString()} clients
            <span className="sep">·</span>
            {counts.specialists} specialists
            <span className="sep">·</span>
            {counts.staff} staff
          </div>
        </div>
      </div>

      <p className="staff-legend">
        StaffVA keeps its people in three unrelated tables, so until now finding
        somebody meant already knowing which of four pages they were on. Search here
        works across all of them. Each row links to where that person is managed
        today — for candidates that is still the review queue, because the admin
        candidate record does not exist yet.
      </p>

      {/* Tabs */}
      <div className="users-tabs" role="tablist" aria-label="Population">
        {POPULATIONS.map((p) => (
          <Link
            key={p.id}
            href={tabHref(p.id, q)}
            role="tab"
            aria-selected={tab === p.id}
            className={`users-tab${tab === p.id ? " active" : ""}`}
          >
            {p.label}
            <span className="tab-count">{counts[p.id].toLocaleString()}</span>
          </Link>
        ))}
      </div>

      {/* Search — a plain GET form, so it works, is linkable, and needs no JS. */}
      <form method="get" action="/admin/users" className="users-toolbar">
        <input type="hidden" name="tab" value={tab} />
        <div className="toolbar-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7.5" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search by name or email…"
            aria-label="Search this population by name or email"
          />
        </div>
        <button type="submit" className="adm-btn primary">Search</button>
        {q && <Link href={tabHref(tab, "")} className="adm-btn">Clear</Link>}
      </form>

      {directory.total > 0 ? (
        <>
          <div className="adm-panel">
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Detail</th>
                    <th>Status</th>
                    <th>Joined</th>
                    <th style={{ textAlign: "right" }}>Where</th>
                  </tr>
                </thead>
                <tbody>
                  {directory.rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className="user-cell">
                          <span className="user-avatar" aria-hidden="true">
                            {r.photoUrl
                              /* eslint-disable-next-line @next/next/no-img-element */
                              ? <img src={r.photoUrl} alt="" />
                              : initials(r.name, r.email)}
                          </span>
                          <span className="user-cell-text">
                            <span className="name">{r.name}</span>
                            <span className="user-cell-email">{r.email || "no email on record"}</span>
                          </span>
                        </div>
                      </td>
                      <td>{r.meta}</td>
                      <td><span className={`adm-pill ${r.status.tone}`}>{r.status.label}</span></td>
                      <td className="num">{fmtDate(r.joinedAt)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <Link href={r.href} className="row-link">{r.hrefLabel}</Link>
                        {r.publicHref && (
                          <>
                            {" "}
                            <Link href={r.publicHref} className="row-link">Profile</Link>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="users-pager">
            <span className="pager-meta">
              {showingFrom.toLocaleString()}–{showingTo.toLocaleString()} of {directory.total.toLocaleString()}
            </span>
            <span className="pager-controls">
              {page > 1
                ? <Link href={pageHref(tab, q, page - 1)} className="adm-btn">Previous</Link>
                : <span className="adm-btn" aria-disabled="true" style={{ opacity: 0.45 }}>Previous</span>}
              <span className="pager-meta">Page {page} of {lastPage}</span>
              {page < lastPage
                ? <Link href={pageHref(tab, q, page + 1)} className="adm-btn">Next</Link>
                : <span className="adm-btn" aria-disabled="true" style={{ opacity: 0.45 }}>Next</span>}
            </span>
          </div>
        </>
      ) : (
        <div className="adm-state">
          {q
            ? <>Nobody in {POPULATIONS.find((p) => p.id === tab)!.label.toLowerCase()} matches “{q}”.</>
            : <>There are no {POPULATIONS.find((p) => p.id === tab)!.label.toLowerCase()} yet.</>}
        </div>
      )}
    </div>
  );
}
