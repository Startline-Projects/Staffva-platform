import PortalSidebar from "./PortalSidebar";
import PortalTopbar from "./PortalTopbar";
import "@/app/landing.css";
import "@/app/atlas-auth.css";
import "@/app/atlas-dash.css";
import "@/app/atlas-live.css";

/**
 * The Atlas candidate dashboard shell — .dash-layout with the fixed sidebar
 * (bottom bar on mobile), the topbar with the notifications bell, and the
 * content column. One shell for BOTH phases: pre-approval shows the
 * Dashboard / My Application / Help rail, live mode swaps in the full rail
 * (Find work, Messages, Contracts, Reviews...). Every /candidate portal page
 * renders inside it via the (portal) route-group layout, which is what makes
 * the sidebar's active state and the bell identical across pages instead of
 * five slightly different navbars.
 *
 * Styling rides on the same scoping the pipeline dashboard established:
 * tokens on .lp (landing.css), dashboard rules under .lp-dash (atlas-dash.css
 * for the pipeline, atlas-live.css for the shell + live home + bell — both
 * extracted from the Atlas prototype, not approximated).
 */
export interface PortalUser {
  /** Live = approved; everything else gets the pre-approval rail. */
  mode: "live" | "applicant";
  firstName: string;
  /** For the sidebar footer avatar. */
  initial: string;
  displayName: string;
  /** "Live · Available", "In review · Step 4", ... */
  statusLine: string;
  /** Own public profile path, for the Profile nav item (live only). */
  profilePath: string | null;
  /** Unread specialist messages — the Messages nav + topbar badge. */
  unreadMessages: number;
}

export default function PortalShell({
  user,
  children,
}: {
  user: PortalUser;
  children: React.ReactNode;
}) {
  return (
    <div className="lp lp-auth lp-dash">
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900&family=Geist:wght@300..900&family=Geist+Mono:wght@400..600&display=swap"
        rel="stylesheet"
      />
      <div className={`dash-layout${user.mode === "live" ? " live-mode" : ""}`}>
        <PortalSidebar user={user} />
        <div className="dash-main">
          <PortalTopbar user={user} />
          <div className="dash-content">{children}</div>
        </div>
      </div>
    </div>
  );
}
