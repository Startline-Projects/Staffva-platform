import Link from "next/link";
import { loadOwnProfile } from "@/lib/adminStaff";
import { CAPABILITIES, ROLE_LABEL, can, domainSummary } from "@/lib/adminCapabilities";

export const dynamic = "force-dynamic";

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

function ago(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

const Tick = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>
);
const Cross = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
);
const ShieldIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21.5s7.5-3.8 7.5-9.5V5.2L12 2.5 4.5 5.2V12c0 5.7 7.5 9.5 7.5 9.5z" /><path d="M12 9v4M12 16.2v.1" /></svg>
);

export default async function AdminProfilePage() {
  const profile = await loadOwnProfile();

  if (!profile) {
    return (
      <div className="adm-state error" role="alert">
        <strong>Your profile could not be read.</strong>
        <p style={{ marginTop: 8 }}>
          The session is valid — the layout would not have let you in otherwise — but
          the matching <code>profiles</code> row did not come back. Reload; if it
          persists, the row is missing.
        </p>
      </div>
    );
  }

  const { role } = profile;
  const name = profile.fullName || profile.email;
  const mfaOn = profile.mfaFactors > 0;

  return (
    <div className="adm-col" style={{ maxWidth: 980 }}>
      <div className="prof-hero">
        <div className="prof-hero-top">
          <div className="prof-avatar">
            {profile.photoUrl
              /* eslint-disable-next-line @next/next/no-img-element */
              ? <img src={profile.photoUrl} alt="" />
              : initials(profile.fullName, profile.email)}
          </div>

          <div style={{ minWidth: 0 }}>
            <h1 className="prof-name">
              {name}
              <span className="admin-role-pill" data-role={role}>
                <span className="admin-role-dot" aria-hidden="true" />
                {ROLE_LABEL[role]}
              </span>
            </h1>
            <div className="prof-contact">
              <span className="contact-item">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="m3 6.5 9 6 9-6" /></svg>
                {profile.email}
                {profile.emailVerified && <span className="verified-dot" title="Confirmed" />}
              </span>
              {profile.phone && (
                <span className="contact-item">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.7 1.5A16.5 16.5 0 0 1 3.5 5.2 1.5 1.5 0 0 1 5 3.5Z" /></svg>
                  {profile.phone}
                  <span className={`verified-dot${profile.phoneVerified ? "" : " off"}`} title={profile.phoneVerified ? "Verified" : "Not verified"} />
                </span>
              )}
            </div>
          </div>

          <div className="prof-hero-actions">
            {/* Password changes go through the normal reset flow — there is no
                separate in-session change screen in this product, and inventing
                one here would be a second path to the same credential. */}
            <Link href="/forgot-password" className="adm-btn">Change password</Link>
            <form action="/auth/signout" method="POST">
              <button type="submit" className="adm-btn" style={{ width: "100%" }}>Sign out</button>
            </form>
          </div>
        </div>

        <div className="prof-quickstats">
          <div className="prof-quickstat">
            <div className="qs-label">Role</div>
            <div className="qs-value">{ROLE_LABEL[role]}</div>
            <div className="qs-sub">{role}</div>
          </div>
          <div className="prof-quickstat">
            <div className="qs-label">Last sign-in</div>
            <div className="qs-value">{ago(profile.lastSignInAt)}</div>
            <div className="qs-sub">{fmtDate(profile.lastSignInAt)}</div>
          </div>
          <div className="prof-quickstat">
            <div className="qs-label">Two-factor</div>
            <div className={`qs-value${mfaOn ? "" : " warn"}`}>{mfaOn ? "On" : "Off"}</div>
            <div className="qs-sub">{mfaOn ? `${profile.mfaFactors} verified` : "no factors"}</div>
          </div>
          <div className="prof-quickstat">
            <div className="qs-label">Account since</div>
            <div className="qs-value">{fmtDate(profile.joinedAt)}</div>
            <div className="qs-sub">{profile.isActive ? "active" : "inactive"}</div>
          </div>
        </div>
      </div>

      {/* Only conditions that are true right now get a banner. */}
      {!mfaOn && (
        <div className="prof-banner">
          <span className="prof-banner-icon" aria-hidden="true"><ShieldIcon /></span>
          <div className="prof-banner-body">
            <div className="prof-banner-title">Two-factor authentication is off</div>
            <div className="prof-banner-text">
              This account signs in with a password alone, on a panel that can approve
              candidates, ban accounts and read every client&apos;s spend. The server
              side of two-factor is already built — backup codes and MFA recovery both
              exist and both demand an <code>aal2</code> session — but the product has
              no enrolment screen anywhere, so a second factor cannot be switched on.
              That is a build, not a setting.
            </div>
          </div>
        </div>
      )}

      {!profile.emailVerified && (
        <div className="prof-banner danger">
          <span className="prof-banner-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16.2v.1" /></svg>
          </span>
          <div className="prof-banner-body">
            <div className="prof-banner-title">Email address is not confirmed</div>
            <div className="prof-banner-text">Password recovery goes to an address nobody has proved is reachable.</div>
          </div>
        </div>
      )}

      {profile.suspendedAt && (
        <div className="prof-banner danger">
          <span className="prof-banner-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></svg>
          </span>
          <div className="prof-banner-body">
            <div className="prof-banner-title">This account is suspended</div>
            <div className="prof-banner-text">Suspended {fmtDate(profile.suspendedAt)}.</div>
          </div>
        </div>
      )}

      <section className="adm-section" style={{ marginTop: 24 }}>
        <div className="adm-section-head">
          <h2>
            What this role can do
            <span className="count">{ROLE_LABEL[role]}</span>
          </h2>
        </div>

        <p className="staff-legend">
          StaffVA has no permissions table. Access is decided by the role in your
          session and a check written at the top of each route handler, so this list
          is those checks, read off the code, with the file that decides each one.
          It is not configurable from here — changing what a role reaches means
          changing a guard.
        </p>

        <div className="perms-grid">
          {CAPABILITIES.map((domain) => {
            const s = domainSummary(role, domain);
            return (
              <div key={domain.id} className="perms-domain">
                <div className="perms-domain-header">
                  <span className="perms-domain-name">{domain.label}</span>
                  <span className="perms-domain-summary">
                    <span className={s.level}>{s.allowed} of {s.total}</span> allowed
                  </span>
                </div>
                <div>
                  {domain.items.map((cap) => {
                    const allowed = can(role, cap);
                    return (
                      <div key={cap.name} className="perm-row">
                        <div className="perm-info">
                          <div className="perm-name">{cap.name}</div>
                          <div className="perm-note">{cap.note}</div>
                          <div className="perm-source">{cap.source}</div>
                        </div>
                        <span className={`perm-status ${allowed ? "allowed" : "restricted"}`}>
                          {allowed ? <Tick /> : <Cross />}
                          {allowed ? "Allowed" : "Admin only"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
