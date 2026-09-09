import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import ApprovalsView from "@/components/client/portal/ApprovalsView";

/**
 * Approvals (Atlas step 17, "Time & Approvals") — rebuilt as what a client
 * actually decides.
 *
 * Atlas's screen is timesheets end to end: days worked, editable hour cells,
 * "Approve & release $184". The owner's D2 keeps funded periods and rules
 * timesheets out, so there are no hours to approve. What is really waiting on
 * a client is money: fund a period or milestone, and release a milestone the
 * candidate has marked done.
 *
 * This is also the one page where verification legitimately gates something.
 * D1 gates ESCROW FUNDING and nothing else, and funding is exactly what this
 * page does — so the state is read here and the funding buttons say so,
 * rather than letting the client discover it from a 403.
 */
export default async function ApprovalsPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/approvals");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: base } = await admin
    .from("clients").select("id").eq("user_id", user.id).maybeSingle();
  if (!base) redirect("/team");

  // The gate columns are read SEPARATELY and fail SOFT, the same position the
  // portal layout and /verify take: migration `client_verification` may not be
  // applied, and a missing column must not 500 the page that shows a client
  // what they owe. Unreadable means "don't claim they're verified" — the
  // funding route is the real gate and fails closed there.
  let canFund = false;
  const { data: gate, error: gateErr } = await admin
    .from("clients")
    .select("id_verification_status, payment_method_last4")
    .eq("id", base.id)
    .maybeSingle();
  if (!gateErr && gate) {
    canFund = gate.id_verification_status === "passed" && !!gate.payment_method_last4;
  }

  return <ApprovalsView canFund={canFund} gateReadable={!gateErr} />;
}
