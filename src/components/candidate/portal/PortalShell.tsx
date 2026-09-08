import PortalSidebar from "./PortalSidebar";
import PortalTopbar from "./PortalTopbar";
import PortalFrame from "@/components/portal/PortalFrame";

/**
 * The Atlas candidate dashboard shell — the shared PortalFrame (sidebar,
 * topbar, content column, and the four stylesheets the chrome needs) wrapped
 * around the candidate's own rail and topbar. One shell for BOTH phases:
 * pre-approval shows the Dashboard / My Application / Help rail, live mode
 * swaps in the full rail (Find work, Messages, Contracts, Reviews...). Every
 * /candidate portal page renders inside it via the (portal) route-group
 * layout, which is what makes the sidebar's active state and the bell
 * identical across pages instead of five slightly different navbars.
 *
 * The client portal renders the same frame with its own rail — see
 * src/components/client/portal/ClientPortalShell.tsx.
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
    <PortalFrame
      layoutClass={user.mode === "live" ? "live-mode" : undefined}
      sidebar={<PortalSidebar user={user} />}
      topbar={<PortalTopbar user={user} />}
    >
      {children}
    </PortalFrame>
  );
}
