/**
 * Read-only: list EVERY policy (all cmds) on the nine USING(true) tables,
 * plus RLS enabled/forced flags. Same RAISE channel as audit-table-grants2.ts.
 *
 * Run: npx tsx --env-file=.env.local /private/tmp/.../dump-nine-table-policies.ts
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mshnsbblwgcpwuxwuevp.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY not found in environment");
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const NINE = [
  "availability_notifications",
  "candidate_interviews",
  "capacity_log",
  "interview_requests",
  "job_post_matches",
  "job_posts",
  "recruiter_assignments",
  "service_orders",
  "service_packages",
];

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

const list = NINE.map((t) => `'${t}'`).join(",");

async function main() {
  await run(
    "all policies on the nine tables",
    `select string_agg(x, e'\\n') from (
       select tablename || ' | ' || policyname || ' | ' || cmd || ' | roles=' ||
              array_to_string(roles, '+') || ' | qual=' || coalesce(qual, '(none)') ||
              ' | check=' || coalesce(with_check, '(none)') as x
         from pg_policies
        where schemaname = 'public' and tablename in (${list})
        order by tablename, policyname) s`
  );

  await run(
    "RLS flags on the nine tables",
    `select string_agg(c.relname || ' | rls=' || c.relrowsecurity || ' | forced=' || c.relforcerowsecurity, e'\\n')
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in (${list})`
  );

  await run(
    "current UPDATE/INSERT grants on the nine tables",
    `select string_agg(x, e'\\n') from (
       select table_name || ' | ' || grantee || ' | ' || string_agg(privilege_type, '+') as x
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name in (${list})
          and grantee in ('anon','authenticated')
        group by table_name, grantee
        order by table_name, grantee) s`
  );
}

main();
