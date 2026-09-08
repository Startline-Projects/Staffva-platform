import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import ClientNotifSettings from "@/components/client/portal/ClientNotifSettings";

/**
 * Client notification settings (the Atlas notif-settings view). Reached from
 * the bell dropdown's footer; the portal shell wraps it via the
 * (client-portal) layout, which also enforces the client-role gate.
 */
export default async function ClientNotificationSettingsPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/settings/notifications");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: client, error } = await admin
    .from("clients")
    .select("id, email, muted_notification_categories")
    .eq("user_id", user.id)
    .maybeSingle();
  // Fail loud: a DB hiccup must not render as "your preferences are all
  // defaults" — the user would then believe a setting they never chose.
  if (error) throw new Error(`client notification prefs lookup failed: ${error.message}`);
  if (!client) redirect("/team");

  return (
    <ClientNotifSettings
      initialMuted={client.muted_notification_categories ?? []}
      email={client.email ?? user.email ?? ""}
    />
  );
}
