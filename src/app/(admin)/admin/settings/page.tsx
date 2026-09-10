import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import SettingsForm from "@/components/admin/SettingsForm";

export const dynamic = "force-dynamic";

const DEFAULT_THRESHOLD = 3;

async function loadSettings(): Promise<{ threshold: number; stored: boolean; updatedAt: string | null } | null> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  if (!user || (role !== "admin" && role !== "recruiting_manager")) return null;

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await db.from("platform_settings").select("settings, updated_at").limit(1).maybeSingle();
  if (error) return null;

  const stored = (data?.settings ?? {}) as Record<string, unknown>;
  const has = typeof stored.cheat_flag_threshold === "number";

  return {
    threshold: has ? (stored.cheat_flag_threshold as number) : DEFAULT_THRESHOLD,
    stored: has,
    updatedAt: data?.updated_at ?? null,
  };
}

export default async function SettingsPage() {
  const settings = await loadSettings();

  if (!settings) {
    return (
      <div className="adm-state error" role="alert">
        <strong>Settings could not be read.</strong>
        <p style={{ marginTop: 8 }}>Reload; if it persists, check <code>SUPABASE_SERVICE_ROLE_KEY</code>.</p>
      </div>
    );
  }

  return (
    <div className="adm-col" style={{ maxWidth: 760 }}>
      <div className="adm-page-header">
        <div>
          <div className="adm-eyebrow">Platform</div>
          <h1>Settings <span className="adm-serif-italic">worth having.</span></h1>
          <div className="adm-subhead">
            One stored setting
            {settings.updatedAt && <><span className="sep">·</span>row last touched {new Date(settings.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</>}
          </div>
        </div>
      </div>

      <p className="staff-legend">
        Almost nothing about this platform is configurable from a screen, and this page no longer
        pretends otherwise. What is here is stored in <code>platform_settings.settings</code> and
        read back on load, so a saved value is a value that persisted.
      </p>

      <SettingsForm initial={settings.threshold} stored={settings.stored} />

      <div className="rec-panel" style={{ marginTop: 12 }}>
        <div className="rec-panel-label">Platform fee</div>
        <p className="rec-prose">
          Every live engagement carries a fee of exactly 10% of the candidate&apos;s amount, charged
          to the client on top of it — the candidate receives their full rate. That figure is fixed
          in the code that creates an engagement; it is not a setting, and changing it is a code
          change rather than a form.
        </p>
      </div>

      <div className="rec-panel" style={{ marginTop: 12 }}>
        <div className="rec-panel-label">Elsewhere</div>
        <p className="rec-prose">
          Vendor keys and integration state are not edited here — see{" "}
          <Link href="/admin/vendors" className="row-link">Vendor Health</Link> for what is up and
          what is not. Email templates and the outbox drain live in the codebase and in cron.
        </p>
      </div>
    </div>
  );
}
