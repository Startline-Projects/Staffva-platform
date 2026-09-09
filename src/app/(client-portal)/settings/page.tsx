import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import SettingsHub from "@/components/client/portal/SettingsHub";

/**
 * Settings (Atlas step 21), inside the client portal.
 *
 * Atlas's settings screen has eight panes and roughly thirty controls, of
 * which almost none do anything: Upload/Remove photo, Change password, 2FA
 * Manage, Re-verify, sessions, every permission-matrix cell, all four team
 * actions, all four integrations, data export, cookie preferences, pause
 * account and close account are ALL dead in the prototype, and its save bar
 * reports "3 fields edited" as a hardcoded string regardless of what changed.
 *
 * This hub carries only rows that lead somewhere real, and it links to the
 * pages that already exist rather than cloning them.
 */
export default async function ClientSettingsPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/settings");
  return <SettingsHub email={user.email ?? null} />;
}
