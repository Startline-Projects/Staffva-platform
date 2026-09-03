/**
 * Follow-up read-only audit for migration 00159 (same RAISE channel as
 * scripts/audit-table-grants.ts):
 *  - quals of delete-capable (ALL/DELETE) policies, to see which are
 *    service-role-gated vs. real authenticated paths
 *  - default ACLs (fixed ::text cast)
 *  - ACL of the exec_sql function itself
 *
 * Run: npx tsx --env-file=.env.local scripts/audit-table-grants2.ts
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mshnsbblwgcpwuxwuevp.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY not found in environment");
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

function viaRaise(selectOneText: string): string {
  return `
do $audit$
declare r text;
begin
  select coalesce((${selectOneText}), '(none)') into r;
  raise exception using message = '<<<' || r || '>>>';
end
$audit$;`;
}

async function run(label: string, selectOneText: string) {
  const { data, error } = await admin.rpc("exec_sql", { query: viaRaise(selectOneText) });
  console.log(`\n===== ${label} =====`);
  const body = (data ?? {}) as { success?: boolean; error?: string };
  const msg = error?.message ?? body.error ?? "";
  const m = msg.match(/<<<([\s\S]*)>>>/);
  if (m) console.log(m[1]);
  else console.log("unexpected response:", JSON.stringify({ data, error }).slice(0, 500));
}

async function main() {
  await run(
    "delete-capable policy quals",
    `select string_agg(x, e'\\n') from (
       select tablename || ' | ' || policyname || ' | ' || cmd || ' | roles=' ||
              array_to_string(roles, '+') || ' | qual=' || coalesce(qual, '(none)') as x
         from pg_policies
        where schemaname = 'public' and cmd in ('ALL','DELETE')
        order by tablename, policyname) s`
  );

  await run(
    "default ACLs",
    `select string_agg(x, e'\\n') from (
       select pg_get_userbyid(d.defaclrole) || ' | ' || d.defaclobjtype::text || ' | ' ||
              coalesce(n.nspname, '(global)') || ' | ' || d.defaclacl::text as x
         from pg_default_acl d
         left join pg_namespace n on n.oid = d.defaclnamespace) s`
  );

  await run(
    "exec_sql function ACL",
    `select string_agg(p.proname || ' | ' || coalesce(p.proacl::text, '(default)'), e'\\n')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'exec_sql'`
  );
}

main();
