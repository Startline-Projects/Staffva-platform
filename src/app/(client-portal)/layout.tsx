import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import ClientPortalShell, { type ClientPortalUser } from "@/components/client/portal/ClientPortalShell";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * The (client-portal) route group, mirroring the candidate (portal) group:
 * every client portal page renders inside ONE shell, so the rail, the crumb
 * and the unread badge are identical across them instead of each page
 * carrying its own chrome. Route groups do not change URLs, so /team stays
 * /team — the 1,190-line dashboard simply gains the shell today and splits
 * into portal pages step by step, each one moving into this group as it is
 * built.
 *
 * This layout decides chrome only, never authorization: the pages and their
 * APIs keep their own, stricter gates.
 */
export default async function ClientPortalLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login?next=/team");

  // Send other roles to their own home — but resolve it HERE rather than
  // bouncing through /dashboard. That router forwards every role it does not
  // recognise to /team, so a user whose app_metadata carries no role (the
  // identity split is real on this platform) would ping-pong /team →
  // /dashboard → /team until the browser gave up. Unknown roles get the
  // marketing home, which is a place, not a loop.
  const role = user.app_metadata?.role as string | undefined;
  if (role !== "client") {
    if (role === "candidate") redirect("/candidate/dashboard");
    if (role === "admin") redirect("/admin");
    if (role === "recruiter" || role === "recruiting_manager") redirect("/recruiter");
    redirect("/");
  }

  const db = admin();
  const { data: client, error } = await db
    .from("clients")
    .select("id, full_name, company_name, email")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`client portal lookup failed: ${error.message}`);

  // The verification columns are read separately and fail SOFT, unlike the
  // identity lookup above. They arrive in migration `client_verification`, and code reaches
  // production before a migration does at least as often as the reverse — a
  // missing column here must not 500 the whole portal for every client over
  // a banner. Unreadable means "don't prompt"; it never means "may fund",
  // because the gate that decides that lives in api/escrow/fund, where an
  // unreadable row refuses the payment (fails closed, the safe direction).
  let needsVerification = false;
  let needsCard = false;
  if (client) {
    const { data: gate } = await db
      .from("clients")
      .select("id_verification_status, payment_method_id")
      .eq("id", client.id)
      .maybeSingle();
    if (gate) {
      needsVerification = gate.id_verification_status !== "passed";
      needsCard = !gate.payment_method_id;
    }
  }

  // Unread candidate replies — the Messages rail badge and the topbar dot.
  // sender_type 'candidate' + read_at NULL is the same read-marker contract
  // the messages API stamps when a thread is opened.
  let unreadMessages = 0;
  if (client) {
    const { count } = await db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client.id)
      .eq("sender_type", "candidate")
      .is("read_at", null);
    unreadMessages = count ?? 0;
  }

  const displayName = client?.full_name || user.email?.split("@")[0] || "Your account";
  const portalUser: ClientPortalUser = {
    displayName,
    initial: (displayName[0] || "C").toUpperCase(),
    // The company name if they gave one at signup, their email otherwise —
    // both are facts about the account. Nothing here is a status claim,
    // because clients have no verification state to report until step 4.
    subtitle: client?.company_name || client?.email || user.email || "",
    unreadMessages,
    // The banner prompts only for what is actually missing, and only these
    // two things gate anything (D1: they gate escrow funding, nothing else).
    needsVerification,
    needsCard,
  };

  return <ClientPortalShell user={portalUser}>{children}</ClientPortalShell>;
}
