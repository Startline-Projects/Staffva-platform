-- Fixes an authorization bypass introduced by 00107, one migration earlier.
--
-- Every branch of can_score_second_interview compared
-- `lower(coalesce(column,''))` against `lower(p_interviewer_email)`. With an
-- empty argument that reduces to `'' = ''`, which is TRUE for every row whose
-- stored value is NULL. So an empty caller email authorized the caller against
-- any interview with no second_interviewer_email assigned — which, before 00106
-- landed, was 27 of the 29 that had passed.
--
-- This is reachable rather than theoretical. The calling route builds the
-- argument as:
--
--   const recruiterEmail = user.email || "";
--
-- so a session whose token carries no email produces exactly the empty string
-- that authorizes.
--
-- Found by a negative control, not by reading the function: routing and
-- authorization agreed on all 29 passed interviews, and the positive cases all
-- behaved. Only the deliberate "should this be refused?" checks exposed it.
--
-- Two changes: reject an empty, whitespace-only or NULL email before evaluating
-- anything, and drop the coalesce() defaults so a NULL stored value can never
-- compare equal to anything.
create or replace function public.can_score_second_interview(
  p_interviewer_email text,
  p_interview_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when nullif(btrim(coalesce(p_interviewer_email, '')), '') is null then false
    else exists (
      select 1
        from public.ai_interviews i
        join public.candidates c on c.id = i.candidate_id
       where i.id = p_interview_id
         and (
           lower(i.second_interviewer_email) = lower(p_interviewer_email)
           or exists (
             select 1 from public.profiles p
              where p.id::text = c.assigned_recruiter
                and lower(p.email) = lower(p_interviewer_email)
           )
           or exists (
             select 1
               from public.recruiter_assignments r
               join public.profiles p on p.id = r.recruiter_id
              where r.role_category = c.role_category
                and lower(p.email) = lower(p_interviewer_email)
           )
           or exists (
             select 1 from public.interviewer_delegation d
              where d.company_id = 'staffva'
                and d.role_category = c.role_category
                and lower(d.interviewer_email) = lower(p_interviewer_email)
           )
         )
    )
  end;
$$;

revoke all on function public.can_score_second_interview(text, uuid) from public, anon;
grant execute on function public.can_score_second_interview(text, uuid) to authenticated, service_role;

-- Verified after applying: assigned recruiter -> allowed; an uppercased form of
-- that same address -> allowed; stranger, empty string, whitespace-only, NULL,
-- and a nonexistent interview id -> all refused.
