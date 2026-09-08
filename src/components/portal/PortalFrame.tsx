import "@/app/landing.css";
import "@/app/atlas-auth.css";
import "@/app/atlas-dash.css";
import "@/app/atlas-live.css";

/**
 * The Atlas portal frame, shared by the candidate and client shells: the
 * `.dash-layout` grid with a fixed sidebar (bottom bar on mobile), the topbar,
 * and the scrolling content column.
 *
 * The wrapper carries all three scopes — `--success` and `--shadow-card` are
 * defined under `.lp-auth`, the dashboard rules under `.lp-dash`, the tokens
 * on `.lp` — which is the trap the candidate shell hit during extraction.
 * Both verticals load the same four stylesheets, so the chrome cannot drift
 * between them by loading a different subset.
 */
export default function PortalFrame({
  layoutClass,
  sidebar,
  topbar,
  children,
}: {
  /** Extra class on `.dash-layout` (the candidate rail uses `live-mode`). */
  layoutClass?: string;
  sidebar: React.ReactNode;
  topbar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="lp lp-auth lp-dash">
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900&family=Geist:wght@300..900&family=Geist+Mono:wght@400..600&display=swap"
        rel="stylesheet"
      />
      <div className={`dash-layout${layoutClass ? ` ${layoutClass}` : ""}`}>
        {sidebar}
        <div className="dash-main">
          {topbar}
          <div className="dash-content">{children}</div>
        </div>
      </div>
    </div>
  );
}
