-- Job posts grow up: structured fields for the AI composer, hourly-first
-- rates, and ONE visibility rule.
--
-- The old shape was four text buckets (hours_per_week, budget_range,
-- start_date, description) — and budget_range held MONTHLY buckets
-- ("$800 - $1,200") while every candidate on the platform quotes an HOURLY
-- rate. The composer writes structured fields instead; the legacy columns
-- are relaxed to nullable and kept for the 0-row history.
alter type job_post_status_type add value if not exists 'draft';

alter table public.job_posts
  add column if not exists title text,
  add column if not exists summary text,
  add column if not exists responsibilities jsonb,
  add column if not exists must_have_skills jsonb,
  add column if not exists nice_to_have_skills jsonb,
  add column if not exists rate_type text check (rate_type in ('hourly','fixed')),
  add column if not exists hourly_rate_min numeric check (hourly_rate_min >= 3 and hourly_rate_min <= 500),
  add column if not exists hourly_rate_max numeric check (hourly_rate_max >= 3 and hourly_rate_max <= 500),
  add column if not exists fixed_budget numeric check (fixed_budget > 0 and fixed_budget <= 100000),
  add column if not exists duration_type text check (duration_type in ('ongoing','project')),
  add column if not exists duration_estimate text,
  add column if not exists experience_level text check (experience_level in ('any','junior','mid','senior')),
  add column if not exists hours_per_week_estimate text,
  add column if not exists ai_brief text,
  add column if not exists published_at timestamptz;

alter table public.job_posts
  add constraint job_posts_rate_range_sane
  check (hourly_rate_min is null or hourly_rate_max is null or hourly_rate_min <= hourly_rate_max);

alter table public.job_posts alter column hours_per_week drop not null;
alter table public.job_posts alter column budget_range drop not null;
alter table public.job_posts alter column start_date drop not null;

-- THE visibility rule, written once.
--
-- The owner's decision: only candidates who match the job's role, or who
-- carry one of its must-have skills, ever see the posting. Every surface that
-- shows a job to a candidate — the invite pool today, a job board tomorrow —
-- asks this function. Duplicating this predicate in two query builders is how
-- the approval gates drifted apart; that is the mistake this function exists
-- to prevent.
create or replace function public.job_visible_to_candidate(p_job_id uuid, p_candidate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
      from public.job_posts j
      join public.candidates c on c.id = p_candidate_id
     where j.id = p_job_id
       and j.status = 'active'
       and c.admin_status::text = 'approved'
       and (
         c.role_category = j.role_category
         or exists (
           select 1
             from jsonb_array_elements_text(coalesce(j.must_have_skills, '[]'::jsonb)) js(skill)
            where lower(js.skill) in (
              select lower(cs) from jsonb_array_elements_text(coalesce(c.skills, '[]'::jsonb)) cs
              union
              select lower(ct) from jsonb_array_elements_text(coalesce(c.tools, '[]'::jsonb)) ct
            )
         )
       )
  );
$fn$;

revoke all on function public.job_visible_to_candidate(uuid, uuid) from public, anon;
grant execute on function public.job_visible_to_candidate(uuid, uuid) to authenticated, service_role;
