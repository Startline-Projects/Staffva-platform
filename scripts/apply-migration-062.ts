/**
 * Apply migration 00062 — internal messaging tables
 * Uses exec_sql RPC (same pattern as migrate-badge-renames.mjs)
 * Run: npx tsx scripts/apply-migration-062.ts
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mshnsbblwgcpwuxwuevp.supabase.co";
const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function runSql(sql: string, label: string) {
  const { error } = await admin.rpc("exec_sql", { query: sql });
  if (error) {
    console.log(`❌ ${label}: ${error.message}`);
    return false;
  }
  console.log(`✅ ${label}`);
  return true;
}

async function main() {
  console.log("\n=== Applying migration 00062: internal messaging ===\n");

  await runSql(
    `CREATE TABLE IF NOT EXISTS internal_threads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text,
      is_group boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );`,
    "CREATE TABLE internal_threads"
  );

  await runSql(
    `CREATE TABLE IF NOT EXISTS internal_thread_members (
      thread_id uuid NOT NULL REFERENCES internal_threads(id) ON DELETE CASCADE,
      profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      joined_at timestamptz NOT NULL DEFAULT now(),
      last_read_at timestamptz,
      PRIMARY KEY (thread_id, profile_id)
    );`,
    "CREATE TABLE internal_thread_members"
  );

  await runSql(
    `CREATE TABLE IF NOT EXISTS internal_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id uuid NOT NULL REFERENCES internal_threads(id) ON DELETE CASCADE,
      sender_id uuid NOT NULL REFERENCES profiles(id),
      body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );`,
    "CREATE TABLE internal_messages"
  );

  await runSql(
    `CREATE INDEX IF NOT EXISTS internal_messages_thread_created_idx ON internal_messages (thread_id, created_at);`,
    "CREATE INDEX"
  );

  // Seed group thread with fixed UUID
  await runSql(
    `INSERT INTO internal_threads (id, name, is_group)
     VALUES ('00000000-0000-0000-0000-000000000001', 'StaffVA Team', true)
     ON CONFLICT (id) DO NOTHING;`,
    "Seed StaffVA Team thread"
  );

  await runSql(
    `INSERT INTO internal_thread_members (thread_id, profile_id)
     SELECT '00000000-0000-0000-0000-000000000001', id
     FROM profiles
     WHERE role IN ('recruiter', 'recruiting_manager', 'admin')
     ON CONFLICT DO NOTHING;`,
    "Seed team members"
  );

  // Reload PostgREST schema cache
  await runSql(
    `NOTIFY pgrst, 'reload schema';`,
    "Reload PostgREST schema cache"
  );

  console.log("\n=== Done. Verifying... ===\n");

  // Wait a moment for cache to reload
  await new Promise((r) => setTimeout(r, 2000));

  // Verify tables via PostgREST
  const { data: threads, error: te } = await admin.from("internal_threads").select("id, name").limit(5);
  console.log("internal_threads via PostgREST:", te ? `ERROR: ${te.message}` : `OK — ${threads?.length} rows: ${JSON.stringify(threads)}`);

  const { data: members, error: me } = await admin.from("internal_thread_members").select("thread_id, profile_id").limit(5);
  console.log("internal_thread_members via PostgREST:", me ? `ERROR: ${me.message}` : `OK — ${members?.length} rows`);
}

main().catch(console.error);
