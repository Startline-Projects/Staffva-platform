import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { getUser } from "@/lib/auth";
import VerifyIdClient from "./VerifyIdClient";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export const metadata = { title: "Verify your identity — StaffVA" };

/**
 * The ID verification window, on its own page (step 7). Stripe Identity
 * stays the engine — hosted capture, webhook writes the verdict — this page
 * is the Atlas-skinned shell around it: consent, hand-off, return polling,
 * and honest outcome states, with the 14-day window surfaced throughout.
 */
export default async function VerifyIdPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/verify-id");
  if (user.app_metadata?.role !== "candidate") redirect("/dashboard");

  const admin = getAdminClient();
  const { data: candidate, error } = await admin
    .from("candidates")
    .select("id, id_verification_status, id_verification_consent, id_verification_due_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`candidate lookup failed: ${error.message}`);
  }
  // No application yet means no ID window yet — the dashboard explains the
  // pipeline better than an empty verification page would.
  if (!candidate) redirect("/candidate/dashboard");

  return (
    <VerifyIdClient
      candidateId={candidate.id}
      initialStatus={candidate.id_verification_status || "pending"}
      initiallyConsented={candidate.id_verification_consent === true}
      dueAt={candidate.id_verification_due_at}
    />
  );
}
