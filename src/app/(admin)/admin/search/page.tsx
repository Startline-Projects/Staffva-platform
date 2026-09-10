import Link from "next/link";
import { redirect } from "next/navigation";
import { search } from "@/lib/adminSearch";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stay?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const results = await search(q);

  if (!results) {
    return (
      <div className="adm-state error" role="alert">
        <strong>Search could not run.</strong>
        <p style={{ marginTop: 8 }}>
          This is not the same as no matches. Reload; if it persists, check{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code>.
        </p>
      </div>
    );
  }

  // An id resolves to exactly one record, so go there — unless the caller
  // asked to see the result rather than follow it.
  if (results.jumpTo && sp.stay !== "1") {
    redirect(results.jumpTo.href);
  }

  return (
    <div className="adm-col" style={{ maxWidth: 860 }}>
      <div className="adm-page-header">
        <div>
          <div className="adm-eyebrow">Search</div>
          <h1>
            {q ? <>Results for <span className="adm-serif-italic">{q}</span></> : <>Find <span className="adm-serif-italic">anything.</span></>}
          </h1>
          <div className="adm-subhead">
            {q ? `${results.total} ${results.total === 1 ? "match" : "matches"}` : "People, postings, engagements — or paste an id"}
          </div>
        </div>
      </div>

      <form method="get" action="/admin/search" className="users-toolbar">
        <div className="toolbar-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7.5" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input type="text" name="q" defaultValue={q} placeholder="Name, email, company, posting, or an id…" aria-label="Search everything" autoFocus />
        </div>
        <button type="submit" className="adm-btn primary">Search</button>
      </form>

      {!q ? (
        <p className="staff-legend">
          Searches candidates, clients, talent specialists, administrators and job postings in one
          go. A uuid pasted here goes straight to that record — including engagements, reviews and
          disputes, which have no other way in from a bare id.
        </p>
      ) : results.total === 0 ? (
        <div className="adm-state">
          Nothing matches “{q}”. The query ran — this is an empty result, not a failure.
        </div>
      ) : (
        results.groups.map((g) => (
          <section key={g.kind} className="rec-section">
            <div className="rec-section-head">
              <h2>
                {g.label}
                <span className="count">{g.hits.length}</span>
              </h2>
            </div>
            <div className="adm-panel">
              {g.hits.map((h) => (
                <Link key={h.id} href={h.href} className="search-hit">
                  <span className="search-hit-main">
                    <span className="search-hit-title">{h.title}</span>
                    {h.subtitle && <span className="search-hit-sub">{h.subtitle}</span>}
                  </span>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
