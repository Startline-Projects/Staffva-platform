import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import BillingView from "@/components/client/portal/BillingView";

/**
 * Billing (Atlas step 18), inside the client portal.
 *
 * The rail pointed at /team#escrow. Everything here is derived from
 * payment_periods and milestones at read time — there is no invoice entity,
 * and the client-side charge is not stored anywhere, so it is recomputed
 * through @/lib/escrowMoney, the same helper the approvals queue uses.
 */
export default async function ClientBillingPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/billing");
  return <BillingView />;
}
