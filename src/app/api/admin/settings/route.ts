import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * Platform settings.
 *
 * This route used to write `activation_fee_enabled`, `activation_fee_amount`
 * and `cheat_flag_threshold` as top-level columns. `platform_settings` has
 * four columns — `id`, `updated_at`, `settings` (jsonb) and
 * `recruiter_counter` — and none of those three is among them. Every update
 * therefore failed, the failure was discarded (`const { data } = await …` with
 * no error check), and the route answered 200. The settings page read the
 * value back from the same non-existent column, got undefined, and fell back
 * to its hard-coded default.
 *
 * The net effect: the anti-cheat threshold control has never stored anything.
 * It always displayed 3, saving always said "Saved", and nothing was written.
 *
 * Values now live in the `settings` jsonb, which is what it is for, and both
 * verbs surface their errors instead of swallowing them.
 */

export interface PlatformSettings {
  cheatFlagThreshold: number;
}

export const SETTINGS_DEFAULTS: PlatformSettings = {
  cheatFlagThreshold: 3,
};

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function verifyStaff() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  return (role === "admin" || role === "recruiting_manager") ? user : null;
}

export async function GET() {
  if (!(await verifyStaff())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("platform_settings")
    .select("id, settings, updated_at")
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not read settings." }, { status: 500 });
  }

  const stored = (data?.settings ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    settings: {
      // Kept flat and snake_cased for the one existing consumer:
      // /admin/candidates reads `settings.cheat_flag_threshold` to decide when
      // to highlight a flag count.
      cheat_flag_threshold:
        typeof stored.cheat_flag_threshold === "number"
          ? stored.cheat_flag_threshold
          : SETTINGS_DEFAULTS.cheatFlagThreshold,
    },
    updatedAt: data?.updated_at ?? null,
    /** True when the value came from the row rather than from the default. */
    stored: typeof stored.cheat_flag_threshold === "number",
  });
}

export async function POST(request: Request) {
  if (!(await verifyStaff())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const threshold = body.cheat_flag_threshold;

  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 1 || threshold > 100) {
    return NextResponse.json({ error: "cheat_flag_threshold must be a number between 1 and 100" }, { status: 400 });
  }

  const supabase = getAdminClient();

  const { data: current, error: readErr } = await supabase
    .from("platform_settings")
    .select("id, settings")
    .limit(1)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json({ error: "Could not read the settings row." }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ error: "There is no settings row to update." }, { status: 500 });
  }

  const merged = {
    ...((current.settings ?? {}) as Record<string, unknown>),
    cheat_flag_threshold: Math.round(threshold),
  };

  const { data: updated, error: writeErr } = await supabase
    .from("platform_settings")
    .update({ settings: merged, updated_at: new Date().toISOString() })
    .eq("id", current.id)
    .select("settings, updated_at")
    .single();

  // The whole point of this rewrite: a failed write is reported, not returned
  // as a success with an undefined body.
  if (writeErr || !updated) {
    return NextResponse.json({ error: "Could not save settings." }, { status: 500 });
  }

  return NextResponse.json({
    settings: { cheat_flag_threshold: (updated.settings as Record<string, unknown>).cheat_flag_threshold },
    updatedAt: updated.updated_at,
  });
}
