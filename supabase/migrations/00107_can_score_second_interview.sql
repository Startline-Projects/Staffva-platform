-- Who is allowed to score a second interview.
--
-- The interview app gated this on interviewer_delegation:
--
--   select role_category from interviewer_delegation where interviewer_email = me
--   if (!assignedCategories.includes(interview.role_category)) -> 403
--
-- which is the same vocabulary mismatch described in 00106, on the other side of
-- the flow. interviewer_delegation holds group names, interview.role_category
-- holds a job title, and they intersect only on "Paralegal" — so every recruiter
-- was refused for every candidate who was not a Paralegal.
--
-- That gate has never actually rejected an attacker, because nobody has ever got
-- far enough to attempt one: 0 second interviews have been scored. It has only
-- ever rejected legitimate recruiters.
--
-- This deliberately mirrors resolve_second_interviewer. If routing picks someone
-- that authorization then refuses, the candidate is stranded exactly as before,
-- just one step later — so the two must agree by construction, which is why they
-- live side by side here rather than in application code on either side of the
-- two repositories.
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
  select exists (
    select 1
      from public.ai_interviews i
      join public.candidates c on c.id = i.candidate_id
     where i.id = p_interview_id
       and (
         -- The person this interview was actually routed to.
         lower(coalesce(i.second_interviewer_email,'')) = lower(p_interviewer_email)

         -- The recruiter already handling this candidate.
         or exists (
           select 1 from public.profiles p
            where p.id::text = c.assigned_recruiter
              and lower(coalesce(p.email,'')) = lower(p_interviewer_email)
         )

         -- Owns the job title. Lets a recruiter cover for a colleague without an
         -- admin having to re-route the interview first.
         or exists (
           select 1
             from public.recruiter_assignments r
             join public.profiles p on p.id = r.recruiter_id
            where r.role_category = c.role_category
              and lower(coalesce(p.email,'')) = lower(p_interviewer_email)
         )

         -- The original rule, so the Paralegal case keeps working unchanged.
         or exists (
           select 1 from public.interviewer_delegation d
            where d.company_id = 'staffva'
              and d.role_category = c.role_category
              and lower(coalesce(d.interviewer_email,'')) = lower(p_interviewer_email)
         )
       )
  );
$$;

revoke all on function public.can_score_second_interview(text, uuid) from public, anon;
grant execute on function public.can_score_second_interview(text, uuid) to authenticated, service_role;
