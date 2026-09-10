import PortalShell from "@/components/candidate/portal/PortalShell";
import { loadPortalUser } from "@/lib/portalUser";
import "@/app/landing.css";
import "@/app/atlas-auth.css";
import "@/app/atlas-dash.css";

/**
 * The (apply) route group — the application flow, in the Atlas shell.
 *
 * /apply used to live in (main), which wraps everything in the legacy Navbar.
 * A candidate crossed from the Atlas dashboard into a different header,
 * different typography and red buttons in the middle of one application, and
 * reasonably read it as a different product. The route group changes the
 * chrome without changing the URL — /apply and /apply/us-experience are
 * exactly where they were, and every link to them still resolves.
 *
 * Same shell and same sidebar as the dashboard, from the same loader, so
 * "Dashboard / My Application / Help" cannot say one thing on one page of the
 * flow and something else on the next.
 */
export default async function ApplyLayout({ children }: { children: React.ReactNode }) {
  // Send an unauthenticated visitor back to /apply, not to the dashboard —
  // they were part-way through an application, and finishing it is the thing
  // they were trying to do.
  const portalUser = await loadPortalUser("/apply");
  return (
    <PortalShell user={portalUser}>
      <div className="lp lp-auth">{children}</div>
    </PortalShell>
  );
}
