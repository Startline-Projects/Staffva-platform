import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, email, role, full_name")
    .order("created_at", { ascending: false })
    .limit(20);

  console.log("Profiles error:", error);
  console.log("Profiles count:", profiles?.length);
  for (const p of profiles ?? []) {
    console.log(`  ${p.email} | ${p.role} | ${p.full_name} | ${p.id}`);
  }

  // Check candidate specifically
  const { data: cp, error: cpErr } = await admin
    .from("profiles")
    .select("*")
    .eq("id", "081d246b-4acf-4b05-b069-de58fb8ae412")
    .maybeSingle();
  console.log("\nCandidate profile by ID:", cp ? "FOUND" : "NOT FOUND", cpErr?.message ?? "");

  const { data: cp2 } = await admin
    .from("profiles")
    .select("*")
    .ilike("email", "%devisnor%")
    .maybeSingle();
  console.log("Candidate profile by email pattern:", cp2 ? "FOUND" : "NOT FOUND");
}

main().catch(console.error);
