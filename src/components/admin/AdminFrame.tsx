import { Suspense } from "react";
import PortalFrame from "@/components/portal/PortalFrame";
import { ToastProvider } from "@/components/admin/Toast";
import AdminRail from "./AdminRail";
import AdminBar from "./AdminBar";
import { AdminDrawerProvider } from "./AdminDrawer";
import "@/app/atlas-admin.css";

/**
 * The admin shell: the same Atlas frame the candidate and client portals use,
 * with the admin scope and the admin chrome hung off it.
 *
 * The rail and the topbar both read the query string (to tell Review Queue
 * from Profile Reviews, which are one page under two filters), so each sits
 * behind its own Suspense boundary. Without them a production build of any
 * prerenderable route under `(admin)` fails outright — and it fails only
 * there, because `next dev` renders these routes on demand and never
 * suspends. The fallbacks hold the grid column and the topbar height so the
 * page does not jump as they resolve.
 */
export default function AdminFrame({
  isRecruitingManager,
  userName,
  userEmail,
  children,
}: {
  isRecruitingManager: boolean;
  userName: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <AdminDrawerProvider>
        <PortalFrame
          scopeClass="lp-admin"
          sidebar={
            <Suspense fallback={<aside className="dash-sidebar" aria-hidden="true" />}>
              <AdminRail
                isRecruitingManager={isRecruitingManager}
                userName={userName}
                userEmail={userEmail}
              />
            </Suspense>
          }
          topbar={
            <Suspense fallback={<div className="dash-topbar" aria-hidden="true" />}>
              <AdminBar isRecruitingManager={isRecruitingManager} />
            </Suspense>
          }
        >
          {children}
        </PortalFrame>
      </AdminDrawerProvider>
    </ToastProvider>
  );
}
