/**
 * One-off script: Reset Leyan's password
 * Run: npx tsx scripts/reset-leyan-password.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

// Load .env.local
const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (!process.env[key]) process.env[key] = val;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PASSWORD = "StaffVA@Leyan2026";

async function main() {
  // Find Leyan's profile
  const { data: profile, error: findErr } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("email", "ops@glostaffing.com")
    .single();

  if (findErr || !profile) {
    // Try by name
    const { data: profile2 } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .eq("full_name", "Leyan")
      .single();

    if (!profile2) {
      console.error("Could not find Leyan's profile.");

      // List all profiles to debug
      const { data: all } = await supabase
        .from("profiles")
        .select("id, email, full_name, role")
        .in("role", ["recruiter", "recruiting_manager"]);
      console.log("All recruiter profiles:", JSON.stringify(all, null, 2));
      process.exit(1);
    }
    console.log("Found by name:", profile2.id, profile2.email, profile2.full_name);

    const { error: pwErr } = await supabase.auth.admin.updateUserById(profile2.id, {
      password: PASSWORD,
    });
    if (pwErr) {
      console.error("Failed to reset password:", pwErr.message);
      process.exit(1);
    }
    console.log("Password reset for", profile2.full_name, "(" + profile2.email + ")");
    return;
  }

  console.log("Found:", profile.id, profile.email, profile.full_name);

  const { error: pwErr } = await supabase.auth.admin.updateUserById(profile.id, {
    password: PASSWORD,
  });
  if (pwErr) {
    console.error("Failed to reset password:", pwErr.message);
    process.exit(1);
  }
  console.log("Password reset for", profile.full_name, "(" + profile.email + ")");
  console.log("New password:", PASSWORD);
}

main().catch(console.error);
