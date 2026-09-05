-- An explicit invitation outranks the heuristic that produced the shortlist.
--
-- 00192 put all four predicates in the WHERE of jobs_for_candidate, including
-- for a candidate a client had personally invited. That silently discards the
-- only human-curated signal the platform has, in favour of the guess that
-- merely generated the shortlist.
--
-- The trigger is one click, on the control the product is actively pushing.
-- "Immediately" is the composer's default start date, and job_start_ok narrows
-- those posts to available_now candidates. AvailabilityRateCard — rendered on
-- every live candidate's dashboard — offers "Available from a date", whose hint
-- reads "You stay listed, and clients see when you free up". Choose it and every
-- default-start role leaves your list, invitations included. 26 of the 31 live
-- candidates are currently flagged as needing to revisit that exact setting.
--
-- And the invitation is delivered by nothing else: job_invite is not in the
-- candidate email allowlist, so /candidate/work is the only route by which one
-- ever reaches a person. When the row drops out, the invitation is gone.
--
-- The tell was already in 00192: `order by (m.invited_at is not null) desc`
-- protects invited rows from the LIMIT. They were treated as a privileged class
-- for the limit and not for the filter.
--
-- What does NOT relax: the post must still be published, titled and active.
-- That is the floor for rendering any card at all, not a matching heuristic —
-- an invitation cannot conjure a headline onto a draft.
--
-- candidates_for_job and job_visible_to_candidate are deliberately unchanged:
-- both gate the building of a NEW shortlist, which is exactly where the
-- heuristic belongs.

begin;

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
     -- The floor for any card. Never relaxed, invitation or not.
     and j.status::text = 'active'
     and j.published_at is not null
     and j.title is not null
     -- A human pick outranks the heuristic.
     and ( m.invited_at is not null
           or ( public.job_is_open(j)
                and public.job_skill_or_role_match(j, c)
                and public.job_start_ok(j, c) ) )
   order by (m.invited_at is not null) desc, j.published_at desc
   limit 50;
$$;

commit;
