import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import ProposalsView from "@/components/client/portal/ProposalsView";

/**
 * Proposals (Atlas step 11) — our engagement_offers, from the client's side.
 *
 * The rail pointed at /team#offers, an anchor on the dashboard. This is the
 * page it should have pointed at.
 *
 * Data is fetched client-side from /api/client/proposals so the tabs, the
 * history threads and the money all come from one response and cannot
 * disagree with each other mid-render. The (client-portal) layout has already
 * enforced the client-role gate by the time this renders.
 */
export default async function ProposalsPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/proposals");
  return <ProposalsView />;
}
