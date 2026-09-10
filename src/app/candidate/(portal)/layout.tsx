import PortalShell from "@/components/candidate/portal/PortalShell";
import { loadPortalUser } from "@/lib/portalUser";

/**
 * The (portal) route group: every candidate portal page — dashboard, work,
 * messages, contracts, reviews — renders inside the ONE Atlas shell, which is
 * what makes the sidebar, bell, and unread badge identical across them
 * instead of five pages each importing their own chrome. The public profile
 * (/candidate/[id]) sits outside the group on purpose: it is a marketing
 * surface clients and visitors see, not part of the candidate's portal.
 *
 * The shell's data now comes from loadPortalUser, shared with the (apply)
 * group so the application flow wears the same chrome.
 *
 * Mode is admin_status: approved gets the live rail, everything else the
 * pre-approval rail. Pages keep their own, stricter gates (work/messages/
 * contracts already redirect non-approved candidates) — this layout only
 * decides chrome, never authorization.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const portalUser = await loadPortalUser("/candidate/dashboard");
  return <PortalShell user={portalUser}>{children}</PortalShell>;
}
