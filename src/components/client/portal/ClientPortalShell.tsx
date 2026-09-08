import ClientPortalSidebar from "./ClientPortalSidebar";
import ClientPortalTopbar from "./ClientPortalTopbar";
import UnreadMessagesProvider from "./UnreadMessages";
import VerifyBanner from "./VerifyBanner";
import PortalFrame from "@/components/portal/PortalFrame";

/**
 * The client half of the Atlas portal chrome (prototype step 5). Same frame
 * as the candidate shell — the sidebar rail, the topbar, the content column —
 * with the client's own rail and actions.
 *
 * The notifications bell is live as of step 3 (client_notifications, `client_notifications`);
 * the verify banner as of step 4, and per the owner's D1 it says "verify to
 * fund", never "verify to hire" — hiring is not gated on anything.
 *
 * Also omitted on record: Atlas's global ⌘K search, which is display-only in
 * the prototype too — it has no handler there and no search backend here.
 */
export interface ClientPortalUser {
  /** Sidebar footer + avatar initial. */
  displayName: string;
  initial: string;
  /** Company name when they gave one; otherwise their email. */
  subtitle: string;
  /** Unread candidate messages — the Messages rail badge and topbar dot. */
  unreadMessages: number;
  /** Drives the verify-to-fund banner; both false means nothing to prompt. */
  needsVerification: boolean;
  needsCard: boolean;
}

export default function ClientPortalShell({
  user,
  children,
}: {
  user: ClientPortalUser;
  children: React.ReactNode;
}) {
  return (
    <UnreadMessagesProvider initial={user.unreadMessages}>
      <PortalFrame
        layoutClass="client-rail"
        sidebar={<ClientPortalSidebar user={user} />}
        topbar={<ClientPortalTopbar user={user} />}
      >
        <VerifyBanner needsVerification={user.needsVerification} needsCard={user.needsCard} />
        {children}
      </PortalFrame>
    </UnreadMessagesProvider>
  );
}
