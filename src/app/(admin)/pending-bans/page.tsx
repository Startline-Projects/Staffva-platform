import Link from "next/link";
import { loadPendingBans } from "@/lib/adminSafety";
import BanDecisionButtons from "@/components/admin/BanDecisionButtons";
import { isLive } from "@/lib/candidateStatus";

export const dynamic = "force-dynamic";

const fmtDateTime = (v: string | null) =>
  v ? new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

export default async function PendingBansPage() {
  const bans = await loadPendingBans();

  if (!bans) {
    return (
      <div className="adm-state error" role="alert">
        <strong>Pending bans could not be read.</strong>
        <p style={{ marginTop: 8 }}>
          This is not the same as an empty queue — there may be people awaiting a decision that this
          page cannot see. Reload; if it persists, check <code>SUPABASE_SERVICE_ROLE_KEY</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="adm-col" style={{ maxWidth: 900 }}>
      <div className="adm-page-header">
        <div>
          <div className="adm-eyebrow">Trust &amp; safety</div>
          <h1>Bans awaiting a <span className="adm-serif-italic">ruling.</span></h1>
          <div className="adm-subhead">
            <strong>{bans.length}</strong> {bans.length === 1 ? "request" : "requests"}
          </div>
        </div>
      </div>

      <p className="staff-legend">
        A talent specialist can request a ban; only an administrator can grant one. The person who
        asks cannot also be the person who decides — that separation is the whole point of this
        queue.
      </p>

      {bans.length === 0 ? (
        <div className="adm-state">
          Nobody is waiting on a ban decision. The queue was read successfully — this is genuinely
          empty. No ban has ever been requested on this platform.
        </div>
      ) : (
        <div className="alerts-list">
          {bans.map((b) => (
            <div key={b.id} className="adm-panel" style={{ padding: "16px 18px" }}>
              <div className="rec-hero-top" style={{ padding: 0, gridTemplateColumns: "minmax(0, 1fr) auto", gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="rec-title" style={{ fontSize: 19, marginBottom: 6 }}>
                    <Link href={`/admin/candidates/${b.id}`} className="row-link">{b.name}</Link>
                    <span className="adm-pill bad">Ban requested</span>
                    <span className={`adm-pill ${isLive(b.adminStatus) ? "ok" : "mute"}`}>
                      {b.adminStatus?.replace(/_/g, " ") ?? "—"}
                    </span>
                  </div>
                  <div className="rec-sub">
                    <span>{[b.roleCategory, b.country].filter(Boolean).join(" · ") || "no role or country"}</span>
                  </div>
                  <div className="rec-note-line" style={{ marginTop: 8 }}>
                    Requested by {b.requestedByName ?? "someone no longer on file"} · {fmtDateTime(b.requestedAt)}
                  </div>
                </div>
                <BanDecisionButtons candidateId={b.id} name={b.name} />
              </div>

              <div className="rec-panel" style={{ marginTop: 12 }}>
                <div className="rec-panel-label">Reason given</div>
                {b.reason
                  ? <div className="rec-prose">{b.reason}</div>
                  : <div className="rec-v empty">no reason was recorded with the request</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
