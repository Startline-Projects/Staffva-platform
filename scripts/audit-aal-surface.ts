/**
 * Read-only audit for the aal2 RLS gap: what tables exist, which have
 * RLS + policies for authenticated, whether ANY policy mentions aal,
 * and how many users actually have verified MFA factors.
 *
 * Same RAISE channel as scripts/audit-admin-policies.ts.
 *
 * Run (from platform repo): npx tsx --env-file=.env.local <this file>
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
    "policies mentioning aal anywhere (expect none)",
    `select string_agg(tablename || '.' || policyname, e'\\n')
       from pg_policies
      where schemaname = 'public'
        and (coalesce(qual,'') ilike '%aal%' or coalesce(with_check,'') ilike '%aal%')`
  );

  await run(
    "verified MFA factors: users and factor count",
    `select 'users_with_verified_factor=' || count(distinct user_id) || ' factors=' || count(*)
       from auth.mfa_factors where status = 'verified'`
  );

  await run(
    "every public table: rls flag + policy count per cmd (r=SELECT w=INSERT u=UPDATE d=DELETE a=ALL)",
    `select string_agg(x, e'\\n') from (
       select c.relname || ' | rls=' || c.relrowsecurity
              || ' | pol r=' || coalesce(p.r,0) || ' w=' || coalesce(p.w,0)
              || ' u=' || coalesce(p.u,0) || ' d=' || coalesce(p.d,0) || ' a=' || coalesce(p.a,0)
              || ' | restr=' || coalesce(p.restr,0) as x
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         left join (
           select tablename,
                  count(*) filter (where cmd='SELECT') r,
                  count(*) filter (where cmd='INSERT') w,
                  count(*) filter (where cmd='UPDATE') u,
                  count(*) filter (where cmd='DELETE') d,
                  count(*) filter (where cmd='ALL') a,
                  count(*) filter (where permissive='RESTRICTIVE') restr
             from pg_policies where schemaname='public' group by tablename
         ) p on p.tablename = c.relname
        where n.nspname = 'public' and c.relkind = 'r'
        order by c.relname) s`
  );

  await run(
    "policies granting authenticated INSERT/UPDATE/DELETE/ALL (the write surface)",
    `select string_agg(x, e'\\n') from (
       select tablename || ' | ' || policyname || ' | ' || cmd || ' | roles=' || array_to_string(roles,'+') as x
         from pg_policies
        where schemaname='public'
          and cmd in ('INSERT','UPDATE','DELETE','ALL')
          and ('authenticated' = any(roles) or 'public' = any(roles))
        order by tablename, cmd, policyname) s`
  );
}

main();
