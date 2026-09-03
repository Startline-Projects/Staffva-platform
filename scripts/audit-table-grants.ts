/**
 * Audit PostgreSQL table grants for the PostgREST roles (read-only).
 *
 * exec_sql executes SQL but does not echo SELECT results (see
 * scripts/verify-migration-080.ts), and catalog tables are not exposed over
 * PostgREST. So each query here runs inside a DO block that RAISEs its
 * aggregated result, which comes back in the RPC's error field. Nothing is
 * created or modified — every query is a pg_catalog/information_schema read.
 *
 * Collected: per-table privileges held by anon/authenticated, RLS policies
 * per table/command, default ACLs, and tables without RLS — the input for
 * deciding what migration 00159 revokes.
 *
 * Run: npx tsx --env-file=.env.local scripts/audit-table-grants.ts
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mshnsbblwgcpwuxwuevp.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY not found in environment");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// Wrap an aggregating SELECT (returning one text column named `out`) so its
// result travels back on the RPC error channel.
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
  const { data, error } = await admin.rpc("exec_sql", {
    query: viaRaise(selectOneText),
  });
  console.log(`\n===== ${label} =====`);
  const body = (data ?? {}) as { success?: boolean; error?: string };
  const msg = error?.message ?? body.error ?? "";
  const m = msg.match(/<<<([\s\S]*)>>>/);
  if (m) console.log(m[1]);
  else console.log("unexpected response:", JSON.stringify({ data, error }).slice(0, 500));
}

async function main() {
  await run(
    "grants per table (anon/authenticated)",
    `select string_agg(x, e'\\n') from (
       select table_name || ' | ' || grantee || ' | ' ||
              string_agg(privilege_type, ',' order by privilege_type) as x
         from information_schema.role_table_grants
        where table_schema = 'public'
          and grantee in ('anon','authenticated')
        group by table_name, grantee
        order by table_name, grantee) s`
  );

  await run(
    "RLS policies per table/command",
    `select string_agg(x, e'\\n') from (
       select tablename || ' | ' || cmd || ' | ' ||
              string_agg(policyname || ' [' || array_to_string(roles, '+') || ']', '; ') as x
         from pg_policies
        where schemaname = 'public'
        group by tablename, cmd
        order by tablename, cmd) s`
  );

  await run(
    "default ACLs",
    `select string_agg(x, e'\\n') from (
       select pg_get_userbyid(d.defaclrole) || ' | ' || d.defaclobjtype || ' | ' ||
              coalesce(n.nspname, '(global)') || ' | ' || d.defaclacl::text as x
         from pg_default_acl d
         left join pg_namespace n on n.oid = d.defaclnamespace) s`
  );

  await run(
    "tables without RLS",
    `select string_agg(relname, e'\\n' order by relname)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`
  );
}

main();
