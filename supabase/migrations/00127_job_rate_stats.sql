-- Per-role hourly-rate percentiles from APPROVED candidates -- the grounding
-- for the job composer's rate suggestions. Server-only: it aggregates and
-- rounds, so nothing per-candidate leaks, but there is no reason for a
-- browser to call it directly.
create or replace function public.job_rate_stats()
returns table(role text, p25 numeric, median numeric, p75 numeric, n bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select c.role_category as role,
         round(percentile_cont(0.25) within group (order by c.hourly_rate)::numeric, 0) as p25,
         round(percentile_cont(0.5)  within group (order by c.hourly_rate)::numeric, 0) as median,
         round(percentile_cont(0.75) within group (order by c.hourly_rate)::numeric, 0) as p75,
         count(*) as n
    from public.candidates c
   where c.admin_status::text = 'approved'
     and c.hourly_rate is not null
     and c.hourly_rate between 3 and 500
   group by c.role_category;
$fn$;

revoke all on function public.job_rate_stats() from public, anon, authenticated;
grant execute on function public.job_rate_stats() to service_role;
