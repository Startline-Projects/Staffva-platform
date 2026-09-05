import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import PortalShell, { type PortalUser } from "@/components/candidate/portal/PortalShell";
import { computeVisibility } from "@/lib/candidateVisibility";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * The (portal) route group: every candidate portal page — dashboard, work,
 * messages, contracts, reviews — renders inside the ONE Atlas shell, which is
 * what makes the sidebar, bell, and unread badge identical across them
 * instead of five pages each importing their own chrome. The public profile
 * (/candidate/[id]) sits outside the group on purpose: it is a marketing
 * surface clients and visitors see, not part of the candidate's portal.
 *
 * Mode is admin_status: approved gets the live rail, everything else the
 * pre-approval rail. Pages keep their own, stricter gates (work/messages/
 * contracts already redirect non-approved candidates) — this layout only
 * decides chrome, never authorization.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login?next=/candidate/dashboard");
  if (user.app_metadata?.role !== "candidate") redirect("/dashboard");

  const db = admin();
  const { data: candidate, error } = await db
    .from("candidates")
    .select(
      "id, admin_status, first_name, display_name, full_name, availability_status, permanently_blocked, id_verification_status, id_verification_due_at, availability_last_updated_at, created_at, lock_status"
    )
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`portal candidate lookup failed: ${error.message}`);

  // No candidate row yet (fresh signup mid-application): render the applicant
  // shell around whatever the page decides to do.
  const mode: PortalUser["mode"] = candidate?.admin_status === "approved" ? "live" : "applicant";

  // Unread staff replies — the Messages badge and topbar dot. sender_role
  // 'recruiter' + read_at NULL is the read-marker contract from step 15
  // (read_at stamps when the thread loads).
  let unreadMessages = 0;
  if (candidate) {
    // Specialist replies AND client messages — both land on the same Messages
    // page, so one badge speaks for both. Each uses its table's read-marker
    // contract (recruiter_messages stamps on thread load; messages stamps on
    // thread open via the thread API).
    const [{ count: staffUnread }, { count: clientUnread }] = await Promise.all([
      db
        .from("recruiter_messages")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", candidate.id)
        .eq("sender_role", "recruiter")
        .is("read_at", null),
      db
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", candidate.id)
        .eq("sender_type", "client")
        .is("read_at", null),
    ]);
    unreadMessages = (staffUnread ?? 0) + (clientUnread ?? 0);
  }

  const displayName =
    candidate?.display_name || candidate?.full_name || user.email?.split("@")[0] || "You";
  const firstName =
    candidate?.first_name || displayName.split(" ")[0];

  // application_step is a SLUG ('application_form', 'device_check'…), not a
  // number — printing it raw produced "Step application_form" in the chrome.
  // The dashboard page owns the real pipeline derivation; the chrome states
  // only what admin_status guarantees.
  // The footer must not say "Live · Available" over a profile the marketplace
  // query excludes — the exact three-claims-two-false screen the review
  // caught. Same predicate as the dashboard greeting.
  const searchable =
    mode === "live" && candidate ? computeVisibility(candidate).searchable : false;
  const statusLine =
    mode === "live"
      ? !searchable
        ? "Live · Hidden"
        : candidate?.availability_status === "not_available"
          ? "Live · Paused"
          : "Live · Available"
      : candidate?.admin_status === "pending_review"
        ? "In review"
        : candidate?.admin_status === "rejected"
          ? "Application closed"
          : "Application in progress";

  const portalUser: PortalUser = {
    mode,
    firstName,
    initial: (displayName[0] || "S").toUpperCase(),
    displayName,
    statusLine,
    profilePath: mode === "live" && candidate ? `/candidate/${candidate.id}` : null,
    unreadMessages,
  };

  return <PortalShell user={portalUser}>{children}</PortalShell>;
}
