-- Step 14: one definition of "this candidate may see this job", and a read path
-- that cannot leak the client's brief.
--
-- Four things were true before this migration:
--
--  1. "Matched" had three disagreeing definitions. job_visible_to_candidate()
--     checked job status + approved + role-or-skill. /api/jobs additionally
--     filtered the ID window and availability but NOT permanently_blocked.
--     /api/match filtered permanently_blocked but pasted the ID-window .or()
--     string a third time. computeVisibility() in TS had a fourth. 00126's own
--     comment says the function exists so every surface asks the same question.
--
--  2. The skill match tested job must_have_skills against candidate skills
--     UNION TOOLS. Tools are infrastructure, not qualifications — across the 31
--     approved candidates slack appears on 16, zoom on 15, google workspace on
--     12. A Bookkeeper post requiring "Slack" reached 16 candidates of whom zero
--     were bookkeepers. Skills only, now: all 31 have skills populated (avg 6.1),
--     so nothing collapses to role-only.
--
--  3. status is not a publish gate. It defaults to 'active' at the column level
--     and nothing in the codebase ever writes 'filled', 'closed' or 'draft', so
--     filtering on it filters nothing. published_at is the real marker — and the
--     one live row has published_at NULL with status 'active', which is exactly
--     why it must not appear in a candidate's list.
--
--  4. job_posts.ai_brief holds the client's raw composer prompt. The route that
--     writes it exempts it from containsContact() deliberately, on the stated
--     grounds that it "is never shown to candidates" — "I run acme-shop.com,
--     need a Shopify VA" is the normal way to use a composer. Step 14 is the
--     change that would make that column candidate-visible.
--
-- (4) is why this is an RPC with an explicit column list rather than an RLS
-- policy. Grants on job_posts are table-level, so a row policy hands over every
-- column including ai_brief. Here the omission is a visible line of code that a
-- reviewer can see, and a test can assert on.

begin;

-- ── The predicate, in four reusable parts ───────────────────────────────────

-- Mirrors computeVisibility().matchable in src/lib/candidateVisibility.ts.
-- These two are the pair most likely to drift; scripts/verify-matchable.mjs
-- diffs them row for row.
create or replace function public.candidate_is_matchable(c public.candidates)
returns boolean language sql stable
set search_path = public, pg_temp as $$
  select c.admin_status::text = 'approved'
     and coalesce(c.permanently_blocked, false) = false
     and ( c.id_verification_status::text in ('passed','manual_review')
        or c.id_verification_due_at is null
        or c.id_verification_due_at > now() )
     and c.availability_status::text is distinct from 'not_available'
$$;

-- published_at is the publish marker; 45 days is defined HERE and nowhere else.
-- title not null because a card can never render headline-less.
create or replace function public.job_is_open(j public.job_posts)
returns boolean language sql stable
set search_path = public, pg_temp as $$
  select j.status::text = 'active'
     and j.published_at is not null
     and j.published_at > now() - interval '45 days'
     and j.title is not null
$$;

-- Role equality is case-insensitive: the scorer already lowercases and both
-- read the same free-text column. Skills only — never tools.
create or replace function public.job_skill_or_role_match(j public.job_posts, c public.candidates)
returns boolean language sql stable
set search_path = public, pg_temp as $$
  select lower(c.role_category) = lower(j.role_category)
      or exists (
           select 1 from jsonb_array_elements_text(coalesce(j.must_have_skills,'[]'::jsonb)) js(skill)
            where lower(js.skill) in (
              select lower(cs) from jsonb_array_elements_text(coalesce(c.skills,'[]'::jsonb)) cs)
         )
$$;

-- Mirrors the availability filter /api/jobs already applies, so a candidate is
-- never shown a role they cannot be shortlisted for.
create or replace function public.job_start_ok(j public.job_posts, c public.candidates)
returns boolean language sql stable
set search_path = public, pg_temp as $$
  select j.start_date is distinct from 'Immediately'
      or c.availability_status::text = 'available_now'
$$;

-- ── The candidate's list ────────────────────────────────────────────────────
--
-- The column list IS the enforcement. ai_brief is absent, and so are client_id,
-- description, budget_range and hours_per_week: budget_range holds monthly
-- buckets on the legacy row ("$800 - $1,200") and hourly strings on new ones,
-- so it cannot be rendered without lying about the unit.
create or replace function public.jobs_for_candidate(p_candidate_id uuid)
returns table (
  id uuid, title text, summary text, role_category text,
  responsibilities jsonb, must_have_skills jsonb, nice_to_have_skills jsonb,
  rate_type text, hourly_rate_min numeric, hourly_rate_max numeric, fixed_budget numeric,
  duration_type text, duration_estimate text, experience_level text,
  hours_per_week_estimate text, start_date text,
  published_at timestamptz, invited_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  select j.id, j.title, j.summary, j.role_category,
         j.responsibilities, j.must_have_skills, j.nice_to_have_skills,
         j.rate_type, j.hourly_rate_min, j.hourly_rate_max, j.fixed_budget,
         j.duration_type, j.duration_estimate, j.experience_level,
         j.hours_per_week_estimate, j.start_date,
         j.published_at, m.invited_at
    from public.candidates c
    join public.job_posts j on true
    left join public.job_post_matches m
           on m.job_post_id = j.id and m.candidate_id = c.id
   where c.id = p_candidate_id
     and public.candidate_is_matchable(c)
     and public.job_is_open(j)
     and public.job_skill_or_role_match(j, c)
     and public.job_start_ok(j, c)
   order by (m.invited_at is not null) desc, j.published_at desc
   limit 50;
$$;

-- The mirror, for the client's shortlist. Replaces an N+1 that issued one RPC
-- round trip per candidate in the pool inside a publish request.
create or replace function public.candidates_for_job(p_job_id uuid)
returns table (candidate_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id
    from public.job_posts j
    join public.candidates c on true
   where j.id = p_job_id
     and public.candidate_is_matchable(c)
     and public.job_is_open(j)
     and public.job_skill_or_role_match(j, c)
     and public.job_start_ok(j, c);
$$;

-- Redefined in terms of the same parts so old callers cannot drift away.
create or replace function public.job_visible_to_candidate(p_job_id uuid, p_candidate_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.job_posts j, public.candidates c
     where j.id = p_job_id and c.id = p_candidate_id
       and public.candidate_is_matchable(c) and public.job_is_open(j)
       and public.job_skill_or_role_match(j, c) and public.job_start_ok(j, c));
$$;

-- Lets the PostgREST callers share the candidate half instead of pasting the
-- ID-window .or() string a fourth time.
create or replace view public.matchable_candidates
  with (security_invoker = on) as
  select c.* from public.candidates c where public.candidate_is_matchable(c);

-- ── Grants: service role only ───────────────────────────────────────────────

revoke all on function public.jobs_for_candidate(uuid) from public, anon, authenticated;
revoke all on function public.candidates_for_job(uuid) from public, anon, authenticated;
grant execute on function public.jobs_for_candidate(uuid) to service_role;
grant execute on function public.candidates_for_job(uuid) to service_role;

revoke all on public.matchable_candidates from public, anon, authenticated;
grant select on public.matchable_candidates to service_role;

-- 00126 granted this to authenticated. It is SECURITY DEFINER, takes an
-- unchecked candidate id, and answers questions about candidates the caller
-- cannot read — a visibility oracle. Its only caller uses the service role.
revoke execute on function public.job_visible_to_candidate(uuid, uuid) from authenticated, anon;

-- ── Close the direct browser write path ─────────────────────────────────────
--
-- containsContact() runs only inside the route handler and there are no triggers
-- on job_posts, while "Clients can manage own job posts" is FOR ALL with a null
-- WITH CHECK — so a client could publish a clean post and then PATCH a phone
-- number into title or summary over PostgREST. Nobody read that text before;
-- step 14 is what makes it candidate-visible.
--
-- Rather than duplicate the contactMask regexes in a trigger (a second copy of
-- that ruleset is exactly the drift this migration exists to stop), make the API
-- the only writer. Verified safe: every write to both tables already goes
-- through the service role.
--
-- This also closes a cascade: authenticated held DELETE on job_posts and
-- job_post_matches_job_post_id_fkey is ON DELETE CASCADE, so a client could hard
-- delete a post a candidate was looking at and take the invite history with it.
revoke insert, update, delete on public.job_posts        from anon, authenticated;
revoke insert, update, delete on public.job_post_matches from anon, authenticated;

commit;
