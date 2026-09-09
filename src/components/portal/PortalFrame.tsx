import "@/app/landing.css";
import "@/app/atlas-auth.css";
import "@/app/atlas-dash.css";
import "@/app/atlas-live.css";

/**
 * The Atlas portal frame, shared by the candidate, client and admin shells:
 * the `.dash-layout` grid with a fixed sidebar (bottom bar on mobile), the
 * topbar, and the scrolling content column.
 *
 * The wrapper carries all three scopes — `--success` and `--shadow-card` are
 * defined under `.lp-auth`, the dashboard rules under `.lp-dash`, the tokens
 * on `.lp` — which is the trap the candidate shell hit during extraction.
 * All three verticals load the same four stylesheets, so the chrome cannot
 * drift between them by loading a different subset.
 *
 * `scopeClass` adds a fourth scope for a vertical that extends the shell
 * rather than just filling it in: admin passes `lp-admin`, which is how
 * atlas-admin.css reaches the rail and the content column. It is additive —
 * a vertical that passes nothing gets exactly the portal chrome.
 */
export default function PortalFrame({
  scopeClass,
  layoutClass,
  sidebar,
  topbar,
  children,
}: {
  /** Extra scope on the wrapper, for a vertical with its own stylesheet. */
  scopeClass?: string;
  /** Extra class on `.dash-layout` (the candidate rail uses `live-mode`). */
  layoutClass?: string;
  sidebar: React.ReactNode;
  topbar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`lp lp-auth lp-dash${scopeClass ? ` ${scopeClass}` : ""}`}>
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
