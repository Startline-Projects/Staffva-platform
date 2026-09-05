import type { WorkRole } from "@/lib/candidateWork";

/**
 * Roles a client has posted that this candidate matches.
 *
 * Zero rows today, for everybody — and that is the correct output, not a bug to
 * design around. The one job post in the database has no title, no skills and
 * no published_at, so job_is_open() excludes it.
 *
 * There is no apply button, and that is deliberate rather than unfinished.
 * Nothing could receive the click: no applications table exists, job_post_matches
 * has no status column, and every client-side surface that would have to show
 * the result is either uncalled or hydrates from sessionStorage. A button that
 * writes to a table nobody reads, while telling the candidate something
 * happened, is the exact defect this codebase keeps producing.
 */

/**
 * The rate line, derived from the structured columns only.
 *
 * budget_range is deliberately not used: it holds monthly buckets on the legacy
 * row ("$800 - $1,200") and hourly strings on newer ones, so there is no unit it
 * can be rendered in that is true of both.
 */
function rateLine(r: WorkRole): string | null {
  if (r.rate_type === "fixed" && r.fixed_budget != null) {
    return `$${Number(r.fixed_budget).toLocaleString()} fixed`;
  }
  const lo = r.hourly_rate_min == null ? null : Number(r.hourly_rate_min);
  const hi = r.hourly_rate_max == null ? null : Number(r.hourly_rate_max);
  if (lo != null && hi != null) return `$${lo}–$${hi}/hr`;
  if (lo != null) return `From $${lo}/hr`;
  if (hi != null) return `Up to $${hi}/hr`;
  return null;
}

function postedAgo(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "Posted today";
  if (days === 1) return "Posted yesterday";
  return `Posted ${days} days ago`;
}

export default function OpenRoles({ roles }: { roles: WorkRole[] }) {
  if (roles.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Open roles
      </h2>
      <div className="space-y-3">
        {roles.map((r) => {
          const rate = rateLine(r);
          const invited = !!r.invited_at;
          const responsibilities = (r.responsibilities ?? []).slice(0, 4);
          const mustHave = r.must_have_skills ?? [];
          return (
            <div
              key={r.id}
              className={`rounded-lg border bg-white p-5 ${
                invited ? "border-gray-200 border-l-4 border-l-[#FE6E3E]" : "border-gray-200"
              }`}
            >
              {invited && (
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#FE6E3E]">
                  A client invited you to this role
                </p>
              )}
              <h3 className="text-base font-semibold text-[#1C1B1A]">{r.title}</h3>
              <p className="mt-0.5 text-xs text-gray-500">
                {r.role_category}
                {rate ? ` · ${rate}` : ""}
                {r.hours_per_week_estimate ? ` · ${r.hours_per_week_estimate}` : ""}
                {r.duration_estimate ? ` · ${r.duration_estimate}` : ""}
              </p>

              {r.summary && <p className="mt-2 text-sm leading-relaxed text-gray-700">{r.summary}</p>}

              {responsibilities.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-600">
                  {responsibilities.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}

              {mustHave.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {mustHave.map((s) => (
                    <span
                      key={s}
                      className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}

              <p className="mt-3 text-xs text-gray-400">{postedAgo(r.published_at)}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
