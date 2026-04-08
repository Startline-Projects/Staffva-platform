import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  "https://mshnsbblwgcpwuxwuevp.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data: t1, error: e1 } = await admin.from("internal_threads").select("id, name, is_group").limit(5);
  console.log("internal_threads:", e1 ? "ERROR: " + e1.message : JSON.stringify(t1));

  const { data: t2, error: e2 } = await admin.from("internal_thread_members").select("thread_id, profile_id").limit(10);
  console.log("internal_thread_members:", e2 ? "ERROR: " + e2.message : `${t2?.length} rows`);

  const { data: t3, error: e3 } = await admin.from("internal_messages").select("id").limit(1);
  console.log("internal_messages:", e3 ? "ERROR: " + e3.message : "OK (empty)");
}

main().catch(console.error);
