-- Rewrite the recruiter read policy so it no longer depends on a
-- second-interview column.
--
-- The policy (00109, hardened by 00111) let a recruiter read an ai_interviews row
-- if they were the assigned SECOND interviewer, OR if the candidate was theirs by
-- assignment. The first branch is now unreachable: nothing writes
-- ai_interviews.second_interviewer_email any more, and that column is dropped in
-- 00121 -- ALTER TABLE ... DROP COLUMN raises a dependency error while a policy
-- references it, so this must land first.
--
-- Measured per recruiter before changing, how many interviews each branch
-- exposes. Every real recruiter loses nothing: the assignment branch already
-- covers 100% of what the email branch gave them. Only test-recruiter-eng@
-- staffva.com, a test account with no assignments and no assigned candidates,
-- loses its 2 rows.
drop policy if exists recruiters_select_scoped_ai_interviews on public.ai_interviews;

create policy recruiters_select_scoped_ai_interviews
on public.ai_interviews
for select
to authenticated
using (
  exists (
    select 1
      from public.profiles me
     where me.id = (select auth.uid())
       and (
         me.role = any (array['admin'::user_role_type, 'recruiting_manager'::user_role_type])
         or (
           me.role = 'recruiter'::user_role_type
           and exists (
             select 1
               from public.candidates c
              where c.id = ai_interviews.candidate_id
                and (
                  c.assigned_recruiter = ((select auth.uid()))::text
                  or exists (
                    select 1
                      from public.recruiter_assignments r
                     where r.recruiter_id = (select auth.uid())
                       and r.role_category = c.role_category
                  )
                )
           )
         )
       )
  )
);
