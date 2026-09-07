import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import NotifSettings from "@/components/candidate/portal/NotifSettings";

/**
 * Notification settings (the Atlas notif-settings view). Reached from the
 * bell dropdown's footer. NOT gated on admin_status: applicants get bells
 * too (photo review, profile approval), and a preference page you can only
 * reach after approval would mute nothing for the people the profile
 * category exists for.
 */
export default async function NotificationSettingsPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/candidate/settings/notifications");
  if (user.app_metadata?.role !== "candidate") redirect("/dashboard");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: candidate, error } = await admin
    .from("candidates")
    .select("id, muted_notification_categories")
    .eq("user_id", user.id)
    .maybeSingle();
  // Fail loud, same contract as every sibling portal page: a DB hiccup must
  // not render as "your preferences are all defaults".
  if (error) throw new Error(`notification prefs lookup failed: ${error.message}`);
  if (!candidate) redirect("/candidate/dashboard");

  return <NotifSettings initialMuted={candidate.muted_notification_categories ?? []} />;
}
