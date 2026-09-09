import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import ContractsView from "@/components/client/portal/ContractsView";

/**
 * Contracts (Atlas step 16), inside the client portal.
 *
 * The rail pointed at /team#engagements — a section of the dashboard shared
 * with approvals and reviews, which is three rail rows aimed at one anchor.
 * This is the contracts half of it.
 *
 * Atlas's step 15 contract-generation wizard is NOT rebuilt. Here a contract
 * is generated from the accepted offer (see acceptOffer.ts), so a wizard that
 * asked for rate, hours, cadence and length again would be a second place to
 * enter terms the offer already settled — and a second source of truth for
 * what was agreed. Editing the deal is what countering an offer is for.
 */
export default async function ClientContractsPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/contracts");
  return <ContractsView />;
}
