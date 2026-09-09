"use client";

import { useMemo, useState } from "react";
import { ROLE_LABEL, type StaffRole } from "@/lib/adminCapabilities";
import type { StaffMember } from "@/lib/adminStaff";

function initials(name: string | null, email: string): string {
  const src = (name || "").trim() || email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ago(iso: string | null): { text: string; tone: string } {
  if (!iso) return { text: "never", tone: "bad" };
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return { text: "today", tone: "ok" };
  if (days === 1) return { text: "yesterday", tone: "" };
  if (days < 30) return { text: `${days}d ago`, tone: "" };
  if (days < 90) return { text: `${Math.round(days / 30)}mo ago`, tone: "mute" };
  return { text: `${Math.round(days / 30)}mo ago`, tone: "warn" };
}

export default function StaffRoster({ staff }: { staff: StaffMember[] }) {
  const [filter, setFilter] = useState<"all" | StaffRole>("all");

  const counts = useMemo(() => ({
    all: staff.length,
    admin: staff.filter((s) => s.role === "admin").length,
    recruiting_manager: staff.filter((s) => s.role === "recruiting_manager").length,
  }), [staff]);

  // Counted only over rows whose auth record actually came back. Folding an
  // unknown into "without a second factor" would overstate a security number,
  // and this one is quoted in a banner.
  const mfaKnown = staff.filter((s) => s.mfaFactors !== null);
  const withoutMfa = mfaKnown.filter((s) => s.mfaFactors === 0).length;

  const shown = filter === "all" ? staff : staff.filter((s) => s.role === filter);

  return (
    <div className="adm-col" style={{ maxWidth: 1100 }}>
      <div className="adm-page-header">
        <div>
          <div className="adm-eyebrow">Managers &amp; admins</div>
          <h1>Who can get <span className="adm-serif-italic">in here.</span></h1>
          <div className="adm-subhead">
            {counts.admin} {counts.admin === 1 ? "administrator" : "administrators"}
            <span className="sep">·</span>
            {counts.recruiting_manager} recruiting {counts.recruiting_manager === 1 ? "manager" : "managers"}
          </div>
        </div>
      </div>

      <p className="staff-legend">
        Every account that can reach <code>/admin</code>. Talent specialists are not
        here — they never enter this panel; the layout sends them to their own queue,
        and they have a directory of their own under Talent Specialists.
        &ldquo;Last sign-in&rdquo; is the authentication timestamp from the auth
        record, not a row-modified date.
      </p>

      {withoutMfa > 0 && (
        <div className="prof-banner">
          <span className="prof-banner-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21.5s7.5-3.8 7.5-9.5V5.2L12 2.5 4.5 5.2V12c0 5.7 7.5 9.5 7.5 9.5z" /><path d="M12 9v4M12 16.2v.1" /></svg>
          </span>
          <div className="prof-banner-body">
            <div className="prof-banner-title">
              {withoutMfa === mfaKnown.length
                ? "No account here has two-factor enabled"
                : `${withoutMfa} of ${mfaKnown.length} accounts have no second factor`}
            </div>
            <div className="prof-banner-text">
              These logins can approve candidates, ban accounts and read client spend.
              The server side of two-factor is already built — backup codes and MFA
              recovery both exist and both demand an <code>aal2</code> session — but
              the product has no enrolment screen, so a second factor cannot be
              switched on from anywhere. That is a build, not a setting.
            </div>
          </div>
        </div>
      )}

      <div className="alerts-filter-row" role="tablist" aria-label="Filter by role" style={{ marginBottom: 18 }}>
        {(["all", "admin", "recruiting_manager"] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            className={`alerts-filter${filter === f ? " active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "admin" ? "Admins" : "Managers"}
            <span className="filter-count">{counts[f]}</span>
          </button>
        ))}
      </div>

      {shown.length > 0 ? (
        <div className="staff-grid">
          {shown.map((s) => {
            const seen = ago(s.lastSignInAt);
            const suspended = Boolean(s.suspendedAt);
            const dormant = !s.isActive || suspended;
            return (
              <div key={s.id} className={`staff-card${s.isYou ? " you" : ""}${dormant ? " inactive" : ""}`}>
                <div className="staff-head">
                  <div className={`staff-avatar${s.role === "recruiting_manager" ? " rm" : ""}`}>
                    {s.photoUrl
                      /* eslint-disable-next-line @next/next/no-img-element */
                      ? <img src={s.photoUrl} alt="" />
                      : initials(s.fullName, s.email)}
                  </div>
                  <div className="staff-name-block">
                    <div className="staff-name">
                      {s.fullName || "—"}
                      {s.isYou && <span className="staff-you-tag">You</span>}
                    </div>
                    <div className="staff-email" title={s.email}>{s.email}</div>
                  </div>
                </div>

                <div className="staff-rows">
                  <div className="staff-row">
                    <span className="k">Role</span>
                    <span className="v">{ROLE_LABEL[s.role]}</span>
                  </div>
                  <div className="staff-row">
                    <span className="k">Last sign-in</span>
                    <span className={`v ${seen.tone}`} title={fmtDate(s.lastSignInAt)}>{seen.text}</span>
                  </div>
                  <div className="staff-row">
                    <span className="k">Two-factor</span>
                    <span className={`v ${s.mfaFactors === null ? "mute" : s.mfaFactors > 0 ? "ok" : "warn"}`}>
                      {s.mfaFactors === null ? "unknown" : s.mfaFactors > 0 ? `on · ${s.mfaFactors}` : "off"}
                    </span>
                  </div>
                  <div className="staff-row">
                    <span className="k">Status</span>
                    <span className={`v ${suspended ? "bad" : s.isActive ? "ok" : "warn"}`}>
                      {suspended ? "suspended" : s.isActive ? "active" : "inactive"}
                    </span>
                  </div>
                  <div className="staff-row">
                    <span className="k">Since</span>
                    <span className="v mute">{fmtDate(s.joinedAt)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="adm-state">Nobody holds that role.</div>
      )}
    </div>
  );
}
